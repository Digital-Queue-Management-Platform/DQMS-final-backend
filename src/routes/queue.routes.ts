import { Router } from "express"
import { prisma } from "../server"
import { getLastDailyReset } from "../utils/resetWindow"

const router = Router()
const PRIORITY_SERVICE_SETTING_KEY = 'priority_service_enabled'
const SHOW_SERVICE_TYPE_IN_QUEUE_KEY = 'show_service_type_in_queue'
const DISPLAY_SPEAKER_KEY = 'display_speaker_enabled'

async function getPriorityServiceEnabled() {
  const rows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
    SELECT "booleanValue"
    FROM "AppSetting"
    WHERE "key" = ${PRIORITY_SERVICE_SETTING_KEY}
    LIMIT 1
  `

  return rows[0]?.booleanValue ?? true
}

// Shared in-memory store for manager QR tokens (use Redis or database in production)
interface ManagerQRTokenData {
  outletId: string;
  generatedAt: string;
}

// Import the same storage from customer routes or create shared storage
// For simplicity, we'll access the global storage
declare global {
  var globalManagerQRTokens: Map<string, ManagerQRTokenData> | undefined;
}

if (!global.globalManagerQRTokens) {
  global.globalManagerQRTokens = new Map<string, ManagerQRTokenData>();
}

const managerQRTokens = global.globalManagerQRTokens;

// Get queue status for outlet
router.get("/outlet/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params
    const { officerId } = req.query
    const lastReset = getLastDailyReset()

    // Build waiting tokens filter - only show unassigned tokens or tokens assigned to this officer
    const waitingTokensFilter: any = {
      outletId,
      status: { in: ["waiting", "skipped"] },
      createdAt: { gte: lastReset },
    }

    // If officerId is provided, filter to show only tokens available to this officer
    if (officerId) {
      waitingTokensFilter.OR = [
        { assignedTo: null }, // Unassigned tokens
        { assignedTo: String(officerId) } // Tokens assigned to this officer
      ]
    }

    // Run the four independent queries in parallel
    const [waitingTokens, inServiceTokens, availableOfficers, recentlyCalledTokens] = await Promise.all([
      prisma.token.findMany({
        where: waitingTokensFilter,
        orderBy: { tokenNumber: "asc" },
        include: { customer: true },
      }),
      prisma.token.findMany({
        where: {
          outletId,
          status: "in_service",
          createdAt: { gte: lastReset },
          ...(officerId && { assignedTo: String(officerId) })
        },
        include: { customer: true, officer: true },
      }),
      prisma.officer.count({
        where: {
          outletId,
          status: { in: ["available", "serving"] },
          lastLoginAt: { gte: lastReset }
        },
      }),
      prisma.token.findMany({
        where: {
          outletId,
          calledAt: { gte: lastReset },
          status: { in: ["in_service", "completed", "skipped"] }
        },
        orderBy: { calledAt: "desc" },
        take: 10,
        select: {
          id: true,
          tokenNumber: true,
          counterNumber: true,
          calledAt: true,
          serviceTypes: true,
          status: true
        }
      })
    ])

    // Appointment and transfer-log lookups are only needed when there are waiting tokens
    const waitingTokenIds = waitingTokens.map((t) => t.id)
    let appointmentTokenIdSet = new Set<string>()
    const lastTransferMap = new Map<string, string>()

    if (waitingTokenIds.length > 0) {
      const [appts, transferLogs] = await Promise.all([
        prisma.$queryRaw<{ tokenId: string }[]>`
          SELECT "tokenId" FROM "Appointment" WHERE "tokenId" = ANY(${waitingTokenIds})
        `,
        prisma.transferLog.findMany({
          where: { tokenId: { in: waitingTokenIds }, createdAt: { gte: lastReset } },
          orderBy: { createdAt: "desc" },
        }),
      ])
      appointmentTokenIdSet = new Set((appts || []).map((a) => a.tokenId).filter(Boolean))
      transferLogs.forEach((log) => {
        if (!lastTransferMap.has(log.tokenId)) lastTransferMap.set(log.tokenId, log.fromOfficerId)
      })
    }

    // Attach non-schema helper flags for frontend rendering
    const filteredWaitingTokens = waitingTokens.map((t: any) => ({
      ...t,
      fromAppointment: appointmentTokenIdSet.has(t.id),
      lastTransferByOfficerId: lastTransferMap.get(t.id) || null,
    }))

    // Fetch outlet metadata including display settings
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { name: true, location: true, displaySettings: true }
    })

    res.json({
      waiting: filteredWaitingTokens,
      inService: inServiceTokens,
      recentlyCalled: recentlyCalledTokens,
      availableOfficers,
      totalWaiting: filteredWaitingTokens.length,
      displaySettings: outlet?.displaySettings || null,
      outletMeta: outlet ? { name: outlet.name, location: outlet.location } : null
    })
  } catch (error) {
    console.error("Queue fetch error:", error)
    res.status(500).json({ error: "Failed to fetch queue" })
  }
})

// Get all outlets
router.get("/outlets", async (req, res) => {
  try {
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      include: {
        region: {
          select: {
            id: true,
            name: true,
            managerId: true,
            managerEmail: true,
            managerMobile: true,
            createdAt: true,
            // Exclude managerPassword for safety and compatibility
          }
        },
      },
    })

    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    res.json(outlets)
  } catch (error) {
    console.error("Outlets fetch error:", error)
    // Try without the region include as fallback
    try {
      const outletsWithoutRegion = await prisma.outlet.findMany({
        where: { isActive: true },
      })
      console.log("Fallback: returning outlets without region data")
      res.json(outletsWithoutRegion)
    } catch (fallbackError) {
      console.error("Fallback also failed:", fallbackError)
      res.status(500).json({ error: "Failed to fetch outlets" })
    }
  }
})

// Get all regions (for admin UIs)
router.get('/regions', async (req, res) => {
  try {
    const regions = await prisma.region.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        managerId: true,
        managerEmail: true,
        managerMobile: true,
        createdAt: true,
        // Exclude managerPassword for safety and compatibility
      }
    })
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    res.json(regions)
  } catch (error) {
    console.error('Regions fetch error:', error)
    // Fallback without select
    try {
      const regionsBasic = await prisma.region.findMany({ orderBy: { name: 'asc' } })
      console.log("Fallback: returning regions with basic data")
      res.json(regionsBasic)
    } catch (fallbackError) {
      console.error('Regions fallback also failed:', fallbackError)
      res.status(500).json({ error: 'Failed to fetch regions' })
    }
  }
})

// Services CRUD
// Get services — by default returns only active services (for customers).
// Pass ?all=true to return all services including inactive (for admin management).
router.get('/services', async (req, res) => {
  try {
    const showAll = req.query.all === 'true'
    const services = showAll
      ? await prisma.$queryRaw`SELECT "id","code","title","description","isActive","order","isPriorityService","createdAt" FROM "Service" ORDER BY "order" ASC, "createdAt" ASC`
      : await prisma.$queryRaw`SELECT "id","code","title","description","isActive","order","isPriorityService","createdAt" FROM "Service" WHERE "isActive" = true ORDER BY "order" ASC, "createdAt" ASC`
    res.set('Cache-Control', 'no-store')
    res.json(services)
  } catch (error) {
    console.error('Services fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch services' })
  }
})

router.get('/settings/priority-service', async (_req, res) => {
  try {
    const enabled = await getPriorityServiceEnabled()
    res.json({ enabled })
  } catch (error) {
    console.error('Priority service setting fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch priority service setting' })
  }
})

router.patch('/settings/priority-service', async (req, res) => {
  try {
    const enabled = req.body?.enabled === true

    await prisma.$executeRaw`
      INSERT INTO "AppSetting" ("id", "key", "booleanValue", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${PRIORITY_SERVICE_SETTING_KEY}, ${enabled}, now(), now())
      ON CONFLICT ("key")
      DO UPDATE SET "booleanValue" = EXCLUDED."booleanValue", "updatedAt" = now()
    `

    res.json({ success: true, enabled })
  } catch (error) {
    console.error('Priority service setting update error:', error)
    res.status(500).json({ error: 'Failed to update priority service setting' })
  }
})

router.get('/settings/show-service-type', async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting"
      WHERE "key" = ${SHOW_SERVICE_TYPE_IN_QUEUE_KEY}
      LIMIT 1
    `
    // Default to false (hidden) if not set
    const enabled = rows[0]?.booleanValue ?? false
    res.json({ enabled })
  } catch (error) {
    console.error('Show service type setting fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch show service type setting' })
  }
})

router.patch('/settings/show-service-type', async (req, res) => {
  try {
    const enabled = req.body?.enabled === true

    await prisma.$executeRaw`
      INSERT INTO "AppSetting" ("id", "key", "booleanValue", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${SHOW_SERVICE_TYPE_IN_QUEUE_KEY}, ${enabled}, now(), now())
      ON CONFLICT ("key")
      DO UPDATE SET "booleanValue" = EXCLUDED."booleanValue", "updatedAt" = now()
    `

    res.json({ success: true, enabled })
  } catch (error) {
    console.error('Show service type setting update error:', error)
    res.status(500).json({ error: 'Failed to update show service type setting' })
  }
})

router.get('/settings/display-speaker', async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting"
      WHERE "key" = ${DISPLAY_SPEAKER_KEY}
      LIMIT 1
    `
    const enabled = rows[0]?.booleanValue ?? true
    res.json({ enabled })
  } catch (error) {
    console.error('Display speaker setting fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch display speaker setting' })
  }
})

router.patch('/settings/display-speaker', async (req, res) => {
  try {
    const enabled = req.body?.enabled === true
    await prisma.$executeRaw`
      INSERT INTO "AppSetting" ("id", "key", "booleanValue", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${DISPLAY_SPEAKER_KEY}, ${enabled}, now(), now())
      ON CONFLICT ("key")
      DO UPDATE SET "booleanValue" = EXCLUDED."booleanValue", "updatedAt" = now()
    `
    res.json({ success: true, enabled })
  } catch (error) {
    console.error('Display speaker setting update error:', error)
    res.status(500).json({ error: 'Failed to update display speaker setting' })
  }
})

// Create service
router.post('/services', async (req, res) => {
  try {
    const { code, title, description, order, isPriorityService } = req.body
    if (!code || !title) return res.status(400).json({ error: 'code and title are required' })

    const orderValue = order !== undefined ? order : 999
    const priorityValue = isPriorityService === true

    const service = await prisma.$executeRaw`
      INSERT INTO "Service" ("id","code","title","description","order","isActive","isPriorityService","createdAt")
      VALUES (gen_random_uuid()::text, ${code}, ${title}, ${description || null}, ${orderValue}, true, ${priorityValue}, now())`

    // return created row
    const created = await prisma.$queryRaw`SELECT "id","code","title","description","isActive","order","isPriorityService","createdAt" FROM "Service" WHERE "code" = ${code} LIMIT 1` as any[]
    res.json({ success: true, service: created[0] })
  } catch (error) {
    console.error('Create service error:', error)
    // unique constraint on code could fail
    res.status(500).json({ error: 'Failed to create service' })
  }
})

// Update service
router.patch('/services/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, isActive, order, isPriorityService } = req.body

    // build update query dynamically
    const data: any = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (isActive !== undefined) data.isActive = isActive
    if (order !== undefined) data.order = order
    if (isPriorityService !== undefined) data.isPriorityService = isPriorityService

    // use prisma.$executeRaw for simplicity
    const sets = Object.keys(data).map((k, idx) => `"${k}" = $${idx + 2}`).join(', ')
    if (!sets) return res.status(400).json({ error: 'No fields to update' })

    const params: any[] = [id]
    Object.values(data).forEach((v) => params.push(v))

    // Build parameterized raw query
    const query = `UPDATE "Service" SET ${sets} WHERE "id" = $1 RETURNING *`
    const updated: any = await prisma.$queryRawUnsafe(query, ...params)
    res.json({ success: true, service: updated[0] })
  } catch (error) {
    console.error('Update service error:', error)
    res.status(500).json({ error: 'Failed to update service' })
  }
})

// Delete (hard) service
router.delete('/services/:id', async (req, res) => {
  try {
    const { id } = req.params
    const deleted: any = await prisma.$queryRaw`
      DELETE FROM "Service" WHERE "id" = ${id} RETURNING *`
    res.json({ success: true, service: deleted[0] })
  } catch (error) {
    console.error('Delete service error:', error)
    res.status(500).json({ error: 'Failed to delete service' })
  }
})

// Create a new outlet (branch)
router.post('/outlets', async (req, res) => {
  try {
    const { name, location, regionId, counterCount } = req.body
    if (!name || !location || !regionId) return res.status(400).json({ error: 'name, location and regionId are required' })

    const outlet = await prisma.outlet.create({
      data: { name, location, regionId, isActive: true, counterCount: counterCount ?? 0 }
    })

    // Auto-generate initial QR code for the outlet
    const generateQRToken = (): string => {
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    }

    const qrToken = generateQRToken()
    const generatedAt = new Date().toISOString()

    // Store in manager QR tokens store (no expiry - valid until manually refreshed)
    managerQRTokens.set(qrToken, {
      outletId: outlet.id,
      generatedAt
    })

    console.log(`✅ Auto-generated QR code for new outlet: ${outlet.name} (${outlet.id}) - Token: ${qrToken}`)

    res.json({
      success: true,
      outlet,
      qrCode: {
        token: qrToken,
        generatedAt
      }
    })
  } catch (error) {
    console.error('Create outlet error:', error)
    res.status(500).json({ error: 'Failed to create outlet' })
  }
})

// Update outlet
router.patch('/outlets/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, location, regionId, isActive, counterCount } = req.body

    const data: any = {}
    if (name !== undefined) data.name = name
    if (location !== undefined) data.location = location
    if (regionId !== undefined) data.regionId = regionId
    if (isActive !== undefined) data.isActive = isActive
    if (counterCount !== undefined) data.counterCount = counterCount

    const outlet = await prisma.outlet.update({ where: { id }, data })
    res.json({ success: true, outlet })
  } catch (error) {
    console.error('Update outlet error:', error)
    res.status(500).json({ error: 'Failed to update outlet' })
  }
})

// Soft-delete outlet (set isActive = false)
router.delete('/outlets/:id', async (req, res) => {
  try {
    const { id } = req.params
    const outlet = await prisma.outlet.update({ where: { id }, data: { isActive: false } })
    res.json({ success: true, outlet })
  } catch (error) {
    console.error('Delete outlet error:', error)
    res.status(500).json({ error: 'Failed to delete outlet' })
  }
})

// Get all counters and their current officer status for an outlet
router.get("/outlet/:outletId/counters", async (req, res) => {
  try {
    const { outletId } = req.params

    // Get outlet to know total counters
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { counterCount: true }
    })

    if (!outlet) return res.status(404).json({ error: "Outlet not found" })

    // Get all officers in this outlet that are not offline and have logged in since the last reset
    const lastReset = getLastDailyReset()
    const activeOfficers = await prisma.officer.findMany({
      where: {
        outletId,
        status: { not: "offline" },
        lastLoginAt: { gte: lastReset }
      },
      select: {
        name: true,
        counterNumber: true,
        status: true,
        assignedServices: true,
        id: true
      }
    })

    const counters = []
    const totalCount = outlet.counterCount || 10

    for (let i = 1; i <= totalCount; i++) {
      const officer = activeOfficers.find(o => o.counterNumber === i)
      counters.push({
        number: i,
        isStaffed: !!officer,
        officer: officer ? {
          id: officer.id,
          name: officer.name,
          status: officer.status,
          services: officer.assignedServices
        } : null
      })
    }

    // Also include officers whose counterNumber is null or outside the configured range
    const slottedIds = new Set(activeOfficers.filter(o => o.counterNumber && o.counterNumber >= 1 && o.counterNumber <= totalCount).map(o => o.id))
    for (const officer of activeOfficers) {
      if (!slottedIds.has(officer.id)) {
        counters.push({
          number: null,
          isStaffed: true,
          officer: {
            id: officer.id,
            name: officer.name,
            status: officer.status,
            services: officer.assignedServices
          }
        })
      }
    }

    res.json(counters)
  } catch (error) {
    console.error("Fetch counters error:", error)
    res.status(500).json({ error: "Failed to fetch counters" })
  }
})

export default router
