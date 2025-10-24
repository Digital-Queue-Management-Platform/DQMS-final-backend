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

    // Use a transaction to ensure consistent data
    const queueData = await prisma.$transaction(async (tx) => {
      const waitingTokens = await tx.token.findMany({
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

      const inServiceTokens = await tx.token.findMany({
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

      const availableOfficers = await tx.officer.count({
        where: {
          outletId,
          status: "available",
        },
      })

      return {
        waiting: waitingTokens,
        inService: inServiceTokens,
        availableOfficers,
        totalWaiting: waitingTokens.length,
      }
    })

    res.json(queueData)
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
// Get all services (including inactive ones for admin management)
router.get('/services', async (req, res) => {
  try {
    const services = await prisma.$queryRaw`SELECT * FROM "Service" ORDER BY "createdAt" DESC`
    res.json(services)
  } catch (error) {
    console.error('Services fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch services' })
  }
})

// Create service
router.post('/services', async (req, res) => {
  try {
    const { code, title, description } = req.body
    if (!code || !title) return res.status(400).json({ error: 'code and title are required' })

    const service = await prisma.$executeRaw`
      INSERT INTO "Service" ("id","code","title","description","isActive","createdAt")
      VALUES (gen_random_uuid()::text, ${code}, ${title}, ${description || null}, true, now())`

    // return created row
    const created = await prisma.$queryRaw`SELECT * FROM "Service" WHERE "code" = ${code} LIMIT 1` as any[]
    res.json({ success: true, service: created[0] })  } catch (error) {
    console.error('Create service error:', error)
    // unique constraint on code could fail
    res.status(500).json({ error: 'Failed to create service' })
  }
})

// Update service
router.patch('/services/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, isActive } = req.body

    // build update query dynamically
    const data: any = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (isActive !== undefined) data.isActive = isActive

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

export default router
