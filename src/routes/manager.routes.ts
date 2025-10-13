import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h"

// Manager login with email
router.post("/login", async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: "Email is required" })
    }

    // Find region where managerEmail matches
    const region = await prisma.region.findFirst({
      where: { managerEmail: email },
      include: { outlets: { where: { isActive: true } } },
    })

    if (!region) {
      return res.status(404).json({ error: "Manager not found for this email" })
    }

    // Create manager object with region info
    const manager = {
      id: region.id,
      name: region.name,
      email: region.managerEmail,
      mobile: region.managerMobile,
      regionId: region.id,
      outlets: region.outlets,
    }

    // Sign JWT and set httpOnly cookie
    const token = (jwt as any).sign({ managerId: region.id, email: region.managerEmail }, JWT_SECRET as jwt.Secret, { expiresIn: JWT_EXPIRES })
    res.cookie("dq_manager_jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: "lax",
      path: "/",
    })

    res.json({ success: true, manager })
  } catch (error) {
    console.error("Manager login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Get manager profile
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies.dq_manager_jwt
    if (!token) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const decoded = (jwt as any).verify(token, JWT_SECRET) as { managerId: string; email: string }
    
    const region = await prisma.region.findUnique({
      where: { id: decoded.managerId },
      include: { outlets: { where: { isActive: true } } },
    })

    if (!region) {
      return res.status(404).json({ error: "Manager not found" })
    }

    const manager = {
      id: region.id,
      name: region.name,
      email: region.managerEmail,
      mobile: region.managerMobile,
      regionId: region.id,
      outlets: region.outlets,
    }

    res.json({ manager })
  } catch (error) {
    console.error("Get manager error:", error)
    res.status(401).json({ error: "Invalid token" })
  }
})

// Manager logout
router.post("/logout", async (req, res) => {
  try {
    res.clearCookie("dq_manager_jwt", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    })
    res.json({ success: true, message: "Logged out successfully" })
  } catch (error) {
    console.error("Manager logout error:", error)
    res.status(500).json({ error: "Logout failed" })
  }
})

export default router

// --- Manager protected: Create officer in manager's region ---
router.post("/officers", async (req, res) => {
  try {
    const token = req.cookies?.dq_manager_jwt
    if (!token) return res.status(401).json({ error: "Not authenticated" })
    let payload: any
    try {
      payload = (jwt as any).verify(token, JWT_SECRET)
    } catch {
      return res.status(401).json({ error: "Invalid token" })
    }

  const { name, mobileNumber, outletId, counterNumber, isTraining, languages } = req.body
    if (!name || !mobileNumber || !outletId) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Ensure outlet belongs to manager's region
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
  if (!outlet) return res.status(400).json({ error: "Invalid outletId" })
  if (!outlet.isActive) return res.status(400).json({ error: "Outlet is inactive" })

    const region = await prisma.region.findUnique({ where: { id: payload.managerId } })
    if (!region) return res.status(403).json({ error: "Region not found for manager" })
    if (outlet.regionId !== region.id) {
      return res.status(403).json({ error: "Outlet does not belong to your region" })
    }

    // Prevent duplicate mobile
    const existing = await prisma.officer.findUnique({ where: { mobileNumber } })
    if (existing) {
      return res.status(400).json({ error: "Officer with this mobile already exists" })
    }

    // Validate counter bounds if provided
    if (counterNumber !== undefined && counterNumber !== null && counterNumber !== "") {
      const parsed = Number(counterNumber)
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: "counterNumber must be a non-negative integer" })
      }
      const max = (outlet as any).counterCount ?? 0
      if (parsed > max) {
        return res.status(400).json({ error: `Counter number ${parsed} exceeds available counters (${max}) for this outlet` })
      }
    }

    // Validate languages (optional) - allowed: en, si, ta
    let langs: string[] | undefined
    if (languages !== undefined) {
      if (!Array.isArray(languages)) {
        return res.status(400).json({ error: 'languages must be an array of codes' })
      }
      const allowed = new Set(['en', 'si', 'ta'])
      langs = languages.filter((l: any) => typeof l === 'string' && allowed.has(l))
    }

    const officer = await prisma.officer.create({
      data: ({
        name,
        mobileNumber,
        outletId,
        counterNumber: counterNumber !== undefined && counterNumber !== "" ? Number(counterNumber) : null,
        isTraining: !!isTraining,
        languages: langs ? (langs as any) : undefined,
        status: "offline",
      } as any),
    })

    res.json({ success: true, officer })
  } catch (error) {
    console.error("Manager create officer error:", error)
    res.status(500).json({ error: "Failed to create officer" })
  }
})

// --- Manager: Officers endpoints ---
// Get officers scoped to manager's region
router.get('/officers', async (req, res) => {
  try {
    const token = req.cookies?.dq_manager_jwt
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    let payload: any
    try { payload = (jwt as any).verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Invalid token' }) }

    const officers = await prisma.officer.findMany({
      where: { outlet: { regionId: payload.managerId } },
      include: { outlet: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(officers)
  } catch (error) {
    console.error('Manager fetch officers error:', error)
    res.status(500).json({ error: 'Failed to fetch officers' })
  }
})

// --- Manager: Outlets CRUD (scoped to manager's region) ---
// Create outlet in manager's region
router.post('/outlets', async (req, res) => {
  try {
    const token = req.cookies?.dq_manager_jwt
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    let payload: any
    try { payload = (jwt as any).verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Invalid token' }) }

    const { name, location, counterCount } = req.body || {}
    if (!name || !location) return res.status(400).json({ error: 'name and location are required' })

    const outlet = await prisma.outlet.create({
      data: {
        name,
        location,
        regionId: payload.managerId,
        isActive: true,
        counterCount: Number.isFinite(Number(counterCount)) ? Number(counterCount) : 0,
      },
    })

    res.json({ success: true, outlet })
  } catch (error) {
    console.error('Manager create outlet error:', error)
    res.status(500).json({ error: 'Failed to create outlet' })
  }
})

// Update outlet (only within manager's region)
router.patch('/outlets/:id', async (req, res) => {
  try {
    const token = req.cookies?.dq_manager_jwt
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    let payload: any
    try { payload = (jwt as any).verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Invalid token' }) }

    const { id } = req.params
    const outlet = await prisma.outlet.findUnique({ where: { id } })
    if (!outlet) return res.status(404).json({ error: 'Outlet not found' })
    if (outlet.regionId !== payload.managerId) return res.status(403).json({ error: 'Outlet does not belong to your region' })

    const { name, location, isActive, counterCount } = req.body || {}
    const data: any = {}
    if (name !== undefined) data.name = name
    if (location !== undefined) data.location = location
    if (isActive !== undefined) data.isActive = !!isActive
    if (counterCount !== undefined) {
      const parsed = Number(counterCount)
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'counterCount must be a non-negative integer' })
      }
      data.counterCount = parsed
    }

    const updated = await prisma.outlet.update({ where: { id }, data })
    res.json({ success: true, outlet: updated })
  } catch (error) {
    console.error('Manager update outlet error:', error)
    res.status(500).json({ error: 'Failed to update outlet' })
  }
})

// Soft-delete outlet (set isActive=false) within manager's region
router.delete('/outlets/:id', async (req, res) => {
  try {
    const token = req.cookies?.dq_manager_jwt
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    let payload: any
    try { payload = (jwt as any).verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Invalid token' }) }

    const { id } = req.params
    const outlet = await prisma.outlet.findUnique({ where: { id } })
    if (!outlet) return res.status(404).json({ error: 'Outlet not found' })
    if (outlet.regionId !== payload.managerId) return res.status(403).json({ error: 'Outlet does not belong to your region' })

    const updated = await prisma.outlet.update({ where: { id }, data: { isActive: false } })
    res.json({ success: true, outlet: updated })
  } catch (error) {
    console.error('Manager delete outlet error:', error)
    res.status(500).json({ error: 'Failed to delete outlet' })
  }
})

// Update officer (partial), only if officer belongs to manager's region
router.patch('/officer/:id', async (req, res) => {
  try {
    const token = req.cookies?.dq_manager_jwt
    if (!token) return res.status(401).json({ error: 'Not authenticated' })
    let payload: any
    try { payload = (jwt as any).verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Invalid token' }) }

    const { id } = req.params
  const { counterNumber, assignedServices, status, name, languages } = req.body

    // Ensure officer belongs to manager region
    const existing = await prisma.officer.findUnique({ where: { id }, include: { outlet: true } })
    if (!existing) return res.status(404).json({ error: 'Officer not found' })
    if (existing.outlet.regionId !== payload.managerId) {
      return res.status(403).json({ error: 'Officer does not belong to your region' })
    }

    const data: any = {}
    if (counterNumber !== undefined) {
      const parsed = Number(counterNumber)
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'counterNumber must be a non-negative integer' })
      }
      const max = existing.outlet?.counterCount ?? 0
      if (parsed > max) {
        return res.status(400).json({ error: `Counter number ${parsed} exceeds available counters (${max}) for this outlet` })
      }
      data.counterNumber = parsed
    }
    if (assignedServices !== undefined) data.assignedServices = assignedServices
    if (languages !== undefined) {
      if (!Array.isArray(languages)) {
        return res.status(400).json({ error: 'languages must be an array of codes' })
      }
      const allowed = new Set(['en', 'si', 'ta'])
      const langs = languages.filter((l: any) => typeof l === 'string' && allowed.has(l))
      data.languages = (langs as any)
    }
    if (status !== undefined) data.status = status
    if (name !== undefined) data.name = name

    const officer = await prisma.officer.update({ where: { id }, data })
    res.json({ success: true, officer })
  } catch (error) {
    console.error('Manager update officer error:', error)
    res.status(500).json({ error: 'Failed to update officer' })
  }
})
