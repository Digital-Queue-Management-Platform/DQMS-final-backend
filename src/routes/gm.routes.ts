import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"

function verifyGMToken(req: any): { gmId: string } | null {
    let token = req.cookies?.dq_gm_jwt
    if (!token) {
        const authHeader = req.headers.authorization
        if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7)
    }
    if (!token) return null
    try {
        const payload: any = (jwt as any).verify(token, JWT_SECRET)
        if (!payload.gmId) return null
        return { gmId: payload.gmId }
    } catch { return null }
}

// GM Login
router.post("/login", async (req, res) => {
    try {
        const { mobileNumber } = req.body
        if (!mobileNumber) return res.status(400).json({ error: "Mobile number is required" })

        const gm = await (prisma as any).gM.findFirst({ where: { mobileNumber, isActive: true } })
        if (!gm) return res.status(401).json({ error: "GM not found with this mobile number" })

        const token = (jwt as any).sign({ gmId: gm.id, mobileNumber: gm.mobileNumber }, JWT_SECRET)
        res.cookie("dq_gm_jwt", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" })
        await (prisma as any).gM.update({ where: { id: gm.id }, data: { lastLoginAt: new Date() } })

        res.json({ success: true, token, gm: { id: gm.id, name: gm.name, email: gm.email, mobileNumber: gm.mobileNumber } })
    } catch (err) {
        console.error("GM login error:", err)
        res.status(500).json({ error: "Login failed" })
    }
})

// GM Logout
router.post("/logout", (req, res) => {
    res.clearCookie("dq_gm_jwt", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" })
    res.json({ success: true })
})

// GET /me - GM profile (island-wide, no region filter)
router.get("/me", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const gm = await (prisma as any).gM.findUnique({ where: { id: auth.gmId } })
        if (!gm) return res.status(404).json({ error: "GM not found" })

        // Count DGMs under this GM
        const dgmCount = await (prisma as any).dGM.count({ where: { gmId: gm.id } })
        const regionCount = await prisma.region.count()
        const outletCount = await prisma.outlet.count()

        res.json({ gm: { id: gm.id, name: gm.name, email: gm.email, mobileNumber: gm.mobileNumber, isActive: gm.isActive, dgmCount, regionCount, outletCount } })
    } catch (err) {
        console.error("GM /me error:", err)
        res.status(500).json({ error: "Failed to fetch GM profile" })
    }
})

// GET /feedback - ALL feedbacks island-wide (GMs see everything)
router.get("/feedback", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const { page = "1", limit = "15", rating, startDate, endDate, outletId, regionId } = req.query
        const pageNum = Math.max(1, parseInt(page as string))
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
        const skip = (pageNum - 1) * limitNum

        const where: any = {}
        if (rating && rating !== "") where.rating = parseInt(rating as string)
        if (startDate && endDate) where.createdAt = { gte: new Date(startDate as string), lte: new Date(endDate as string) }
        if (outletId) where.token = { outletId: outletId as string }
        else if (regionId) {
            const outlets = await prisma.outlet.findMany({ where: { regionId: regionId as string }, select: { id: true } })
            where.token = { outletId: { in: outlets.map((o: any) => o.id) } }
        }

        const [feedbacks, total] = await Promise.all([
            prisma.feedback.findMany({
                where, skip, take: limitNum,
                orderBy: { createdAt: "desc" },
                include: {
                    customer: { select: { name: true, mobileNumber: true } },
                    token: { select: { tokenNumber: true, outlet: { select: { name: true, region: { select: { name: true } } } } } }
                }
            }),
            prisma.feedback.count({ where })
        ])

        res.json({ feedbacks, total, page: pageNum, totalPages: Math.ceil(total / limitNum) })
    } catch (err) {
        console.error("GM feedback error:", err)
        res.status(500).json({ error: "Failed to fetch feedback" })
    }
})

// GET /closure-notices - ALL closure notices island-wide
router.get("/closure-notices", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const notices = await (prisma as any).closureNotice.findMany({
            include: { outlet: { select: { name: true, region: { select: { name: true } } } } },
            orderBy: { createdAt: "desc" }
        })

        res.json({ notices })
    } catch (err) {
        console.error("GM closure notices error:", err)
        res.status(500).json({ error: "Failed to fetch closure notices" })
    }
})

// POST /closure-notices - create a closure notice for any outlet
router.post("/closure-notices", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const { outletId, title, message, startsAt, endsAt } = req.body
        if (!outletId || !title || !message || !startsAt || !endsAt)
            return res.status(400).json({ error: "outletId, title, message, startsAt, and endsAt are required" })

        const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
        if (!outlet) return res.status(404).json({ error: "Outlet not found" })

        const notice = await (prisma as any).closureNotice.create({
            data: { outletId, title, message, startsAt: new Date(startsAt), endsAt: new Date(endsAt), createdBy: "gm", createdById: auth.gmId }
        })

        res.json({ success: true, notice })
    } catch (err) {
        console.error("GM create closure notice error:", err)
        res.status(500).json({ error: "Failed to create closure notice" })
    }
})

// DELETE /closure-notices/:id
router.delete("/closure-notices/:id", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const notice = await (prisma as any).closureNotice.findUnique({ where: { id: req.params.id } })
        if (!notice) return res.status(404).json({ error: "Notice not found" })

        await (prisma as any).closureNotice.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        console.error("GM delete closure notice error:", err)
        res.status(500).json({ error: "Failed to delete closure notice" })
    }
})

// ---- DGM MANAGEMENT (GM creates and manages DGMs) ----

// GET /dgms - list all DGMs created by this GM
router.get("/dgms", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const dgms = await (prisma as any).dGM.findMany({
            where: { gmId: auth.gmId },
            orderBy: { createdAt: "desc" }
        })

        // Enrich with region names
        const allRegionIds = [...new Set(dgms.flatMap((d: any) => d.regionIds))] as string[]
        const regions = await prisma.region.findMany({ where: { id: { in: allRegionIds } }, select: { id: true, name: true } })
        const regionMap = Object.fromEntries(regions.map(r => [r.id, r.name]))

        const enriched = dgms.map((d: any) => ({
            ...d,
            regionNames: d.regionIds.map((id: string) => regionMap[id] || id)
        }))

        res.json({ success: true, dgms: enriched })
    } catch (err) {
        console.error("GM list DGMs error:", err)
        res.status(500).json({ error: "Failed to fetch DGMs" })
    }
})

// POST /dgms - create a new DGM
router.post("/dgms", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const { name, mobileNumber, email, regionIds = [] } = req.body
        if (!name || !mobileNumber) return res.status(400).json({ error: "name and mobileNumber are required" })

        const existing = await (prisma as any).dGM.findFirst({ where: { mobileNumber } })
        if (existing) return res.status(400).json({ error: "A DGM with this mobile number already exists" })

        // Check that none of the requested regions are already assigned to another DGM
        if (regionIds.length > 0) {
            const conflicting = await (prisma as any).dGM.findFirst({
                where: { regionIds: { hasSome: regionIds } }
            })
            if (conflicting) {
                const takenRegions = await prisma.region.findMany({ where: { id: { in: regionIds.filter((id: string) => conflicting.regionIds.includes(id)) } }, select: { name: true } })
                const names = takenRegions.map((r: any) => r.name).join(", ")
                return res.status(400).json({ error: `Region(s) already assigned to another DGM: ${names}` })
            }
        }

        const dgm = await (prisma as any).dGM.create({
            data: { name, mobileNumber, email: email || null, gmId: auth.gmId, regionIds, isActive: true }
        })

        res.status(201).json({ success: true, dgm })
    } catch (err) {
        console.error("GM create DGM error:", err)
        res.status(500).json({ error: "Failed to create DGM" })
    }
})

// PUT /dgms/:id - update a DGM (must belong to this GM)
router.put("/dgms/:id", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: req.params.id } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })
        if (dgm.gmId !== auth.gmId) return res.status(403).json({ error: "Not authorized" })

        const { name, mobileNumber, email, regionIds, isActive } = req.body

        // If regionIds are being updated, check for conflicts with other DGMs
        if (regionIds !== undefined && regionIds.length > 0) {
            const conflicting = await (prisma as any).dGM.findFirst({
                where: { regionIds: { hasSome: regionIds }, id: { not: req.params.id } }
            })
            if (conflicting) {
                const takenIds = regionIds.filter((id: string) => conflicting.regionIds.includes(id))
                const takenRegions = await prisma.region.findMany({ where: { id: { in: takenIds } }, select: { name: true } })
                const names = takenRegions.map((r: any) => r.name).join(", ")
                return res.status(400).json({ error: `Region(s) already assigned to another DGM: ${names}` })
            }
        }

        const updated = await (prisma as any).dGM.update({
            where: { id: req.params.id },
            data: {
                ...(name && { name }),
                ...(mobileNumber && { mobileNumber }),
                email: email !== undefined ? (email || null) : undefined,
                ...(regionIds !== undefined && { regionIds }),
                ...(isActive !== undefined && { isActive })
            }
        })

        res.json({ success: true, dgm: updated })
    } catch (err) {
        console.error("GM update DGM error:", err)
        res.status(500).json({ error: "Failed to update DGM" })
    }
})

// DELETE /dgms/:id
router.delete("/dgms/:id", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: req.params.id } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })
        if (dgm.gmId !== auth.gmId) return res.status(403).json({ error: "Not authorized" })

        await (prisma as any).dGM.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        console.error("GM delete DGM error:", err)
        res.status(500).json({ error: "Failed to delete DGM" })
    }
})

// GET /regions - all regions with manager info (for GM dashboard overview)
router.get("/regions", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        const regions = await prisma.region.findMany({
            include: {
                outlets: { select: { id: true, name: true, location: true, isActive: true } }
            },
            orderBy: { name: "asc" }
        })

        // Find which DGM owns which region (globally)
        const allDgms = await (prisma as any).dGM.findMany({
            select: { id: true, name: true, regionIds: true }
        })
        const regionDgmMap = new Map<string, { id: string, name: string }>()
        allDgms.forEach((d: any) => {
            d.regionIds.forEach((rid: string) => {
                regionDgmMap.set(rid, { id: d.id, name: d.name })
            })
        })

        const enrichedRegions = regions.map(r => ({
            ...r,
            assignedDgm: regionDgmMap.get(r.id) || null
        }))

        res.json({ success: true, regions: enrichedRegions })
    } catch (err) {
        console.error("GM regions error:", err)
        res.status(500).json({ error: "Failed to fetch regions" })
    }
})

export default router
