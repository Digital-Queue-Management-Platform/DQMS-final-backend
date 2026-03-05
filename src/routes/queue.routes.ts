import { Router } from "express"
import { prisma } from "../server"
import { getLastDailyReset } from "../utils/resetWindow"

const router = Router()

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
    const lastReset = getLastDailyReset()

    // Fetch in separate queries to avoid long-lived interactive transaction issues (P2028)
    const waitingTokens = await prisma.token.findMany({
      where: {
        outletId,
        status: { in: ["waiting", "skipped"] },
        createdAt: { gte: lastReset },
      },
      orderBy: { tokenNumber: "asc" },
      include: {
        customer: true,
      },
    })

    // Determine which waiting tokens originated from appointments
    const waitingTokenIds = waitingTokens.map((t) => t.id)
    let appointmentTokenIdSet = new Set<string>()
    if (waitingTokenIds.length > 0) {
      // Use raw query for broad compatibility across client versions
      const appts: any[] = await prisma.$queryRaw`
        SELECT "tokenId" FROM "Appointment" WHERE "tokenId" = ANY(${waitingTokenIds})
      `
      appointmentTokenIdSet = new Set((appts || []).map((a: any) => a.tokenId).filter(Boolean) as string[])
    }
    // Attach a non-schema helper flag for frontend rendering
    const waitingWithFlags = waitingTokens.map((t: any) => ({
      ...t,
      fromAppointment: appointmentTokenIdSet.has(t.id),
    }))

    const inServiceTokens = await prisma.token.findMany({
      where: {
        outletId,
        status: "in_service",
        createdAt: { gte: lastReset },
      },
      include: {
        customer: true,
        officer: true,
      },
    })

    const availableOfficers = await prisma.officer.count({
      where: {
        outletId,
        status: "available",
      },
    })

    res.json({
      waiting: waitingWithFlags,
      inService: inServiceTokens,
      availableOfficers,
      totalWaiting: waitingTokens.length,
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

        // If officerId is provided, exclude tokens transferred from this officer
        const { officerId } = req.query
        let filteredWaitingTokens = waitingWithFlags
    
        if (officerId) {
          // Get token IDs transferred from this officer
          const transferredFromOfficer = await prisma.transferLog.findMany({
            where: {
              fromOfficerId: String(officerId),
              createdAt: { gte: lastReset },
            },
            select: { tokenId: true },
          })
          const transferredTokenIds = new Set(transferredFromOfficer.map((t) => t.tokenId))
      
          // Filter out tokens transferred from this officer
          filteredWaitingTokens = waitingWithFlags.filter((t) => !transferredTokenIds.has(t.id))
        }
      console.error('Regions fallback also failed:', fallbackError)
      res.status(500).json({ error: 'Failed to fetch regions' })
    }
  }
})

// Services CRUD
// Get all services (including inactive ones for admin management)
router.get('/services', async (req, res) => {
  try {
    const services = await prisma.$queryRaw`SELECT * FROM "Service" ORDER BY "order" ASC, "createdAt" ASC`
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    res.json(services)
  } catch (error) {
    console.error('Services fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch services' })
  }
})

// Create service
router.post('/services', async (req, res) => {
  try {
    const { code, title, description, order } = req.body
    if (!code || !title) return res.status(400).json({ error: 'code and title are required' })

    const orderValue = order !== undefined ? order : 999

    const service = await prisma.$executeRaw`
      INSERT INTO "Service" ("id","code","title","description","order","isActive","createdAt")
      VALUES (gen_random_uuid()::text, ${code}, ${title}, ${description || null}, ${orderValue}, true, now())`

    // return created row
    const created = await prisma.$queryRaw`SELECT * FROM "Service" WHERE "code" = ${code} LIMIT 1` as any[]
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
    const { title, description, isActive, order } = req.body

    // build update query dynamically
    const data: any = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (isActive !== undefined) data.isActive = isActive
    if (order !== undefined) data.order = order

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

    // Get all officers in this outlet that are not offline
    const activeOfficers = await prisma.officer.findMany({
      where: {
        outletId,
        status: { not: "offline" }
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

    res.json(counters)
  } catch (error) {
    console.error("Fetch counters error:", error)
    res.status(500).json({ error: "Failed to fetch counters" })
  }
})

export default router
