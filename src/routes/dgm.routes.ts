import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"
import emailService from "../services/emailService"

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"

function verifyDGMToken(req: any): { dgmId: string } | null {
    let token = req.cookies?.dq_dgm_jwt
    if (!token) {
        const authHeader = req.headers.authorization
        if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7)
    }
    if (!token) return null
    try {
        const payload: any = (jwt as any).verify(token, JWT_SECRET)
        if (!payload.dgmId) return null
        return { dgmId: payload.dgmId }
    } catch { return null }
}

// DGM Login
router.post("/login", async (req, res) => {
    try {
        const { mobileNumber } = req.body
        if (!mobileNumber) return res.status(400).json({ error: "Mobile number is required" })

        const dgm = await (prisma as any).dGM.findFirst({ where: { mobileNumber, isActive: true } })
        if (!dgm) return res.status(401).json({ error: "DGM not found with this mobile number" })

        const token = (jwt as any).sign({ dgmId: dgm.id, mobileNumber: dgm.mobileNumber }, JWT_SECRET)
        res.cookie("dq_dgm_jwt", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" })
        await (prisma as any).dGM.update({ where: { id: dgm.id }, data: { lastLoginAt: new Date() } })

        res.json({ success: true, token, dgm: { id: dgm.id, name: dgm.name, email: dgm.email, mobileNumber: dgm.mobileNumber, gmId: dgm.gmId, regionIds: dgm.regionIds } })
    } catch (err) {
        console.error("DGM login error:", err)
        res.status(500).json({ error: "Login failed" })
    }
})

// DGM Logout
router.post("/logout", (req, res) => {
    res.clearCookie("dq_dgm_jwt", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" })
    res.json({ success: true })
})

// GET /me - DGM profile with assigned regions
router.get("/me", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const regions = await prisma.region.findMany({
            where: { id: { in: dgm.regionIds } },
            include: {
                outlets: { include: { _count: { select: { officers: true, tokens: true } } } }
            }
        })

        res.json({ dgm: { id: dgm.id, name: dgm.name, email: dgm.email, mobileNumber: dgm.mobileNumber, gmId: dgm.gmId, regionIds: dgm.regionIds, regions } })
    } catch (err) {
        console.error("DGM /me error:", err)
        res.status(500).json({ error: "Failed to fetch DGM profile" })
    }
})

// GET /feedback - feedbacks for all outlets in DGM's regions
router.get("/feedback", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const outlets = await prisma.outlet.findMany({ where: { regionId: { in: dgm.regionIds } }, select: { id: true } })
        const allOutletIds = outlets.map((o: any) => o.id)

        const { page = "1", limit = "15", rating, startDate, endDate, outletId } = req.query
        const pageNum = Math.max(1, parseInt(page as string))
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
        const skip = (pageNum - 1) * limitNum

        let scopedOutletIds = allOutletIds
        if (outletId && allOutletIds.includes(outletId as string)) scopedOutletIds = [outletId as string]

        const where: any = { token: { outletId: { in: scopedOutletIds } } }
        if (rating && rating !== "") where.rating = parseInt(rating as string)
        if (startDate && endDate) where.createdAt = { gte: new Date(startDate as string), lte: new Date(endDate as string) }

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
        console.error("DGM feedback error:", err)
        res.status(500).json({ error: "Failed to fetch feedback" })
    }
})

// GET /closure-notices - notices for all outlets in DGM's regions
router.get("/closure-notices", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const outlets = await prisma.outlet.findMany({ where: { regionId: { in: dgm.regionIds } }, select: { id: true } })
        const outletIds = outlets.map((o: any) => o.id)

        const notices = await (prisma as any).closureNotice.findMany({
            where: { outletId: { in: outletIds } },
            include: { outlet: { select: { name: true, region: { select: { name: true } } } } },
            orderBy: { createdAt: "desc" }
        })

        res.json({ notices })
    } catch (err) {
        console.error("DGM closure notices error:", err)
        res.status(500).json({ error: "Failed to fetch closure notices" })
    }
})

// POST /closure-notices - create notice for an outlet in DGM's regions
router.post("/closure-notices", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const { outletId, title, message, startsAt, endsAt } = req.body
        if (!outletId || !title || !message || !startsAt || !endsAt)
            return res.status(400).json({ error: "outletId, title, message, startsAt, and endsAt are required" })

        const outlet = await prisma.outlet.findFirst({ where: { id: outletId, regionId: { in: dgm.regionIds } } })
        if (!outlet) return res.status(403).json({ error: "Outlet not in your regions" })

        const notice = await (prisma as any).closureNotice.create({
            data: { outletId, title, message, startsAt: new Date(startsAt), endsAt: new Date(endsAt), createdBy: "dgm", createdById: auth.dgmId }
        })

        res.json({ success: true, notice })
    } catch (err) {
        console.error("DGM create closure notice error:", err)
        res.status(500).json({ error: "Failed to create closure notice" })
    }
})

// DELETE /closure-notices/:id
router.delete("/closure-notices/:id", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const outlets = await prisma.outlet.findMany({ where: { regionId: { in: dgm.regionIds } }, select: { id: true } })
        const outletIds = outlets.map((o: any) => o.id)

        const notice = await (prisma as any).closureNotice.findUnique({ where: { id: req.params.id } })
        if (!notice) return res.status(404).json({ error: "Notice not found" })
        if (!outletIds.includes(notice.outletId)) return res.status(403).json({ error: "Not authorized" })

        await (prisma as any).closureNotice.delete({ where: { id: req.params.id } })
        res.json({ success: true })
    } catch (err) {
        console.error("DGM delete closure notice error:", err)
        res.status(500).json({ error: "Failed to delete closure notice" })
    }
})

// ---- RTOM MANAGEMENT (DGM creates and manages RTOMs for their regions) ----

// GET /rtoms - list all RTOM managers in DGM's assigned regions
router.get("/rtoms", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const regions = await prisma.region.findMany({
            where: { id: { in: dgm.regionIds } },
            select: {
                id: true, name: true,
                managerId: true, managerEmail: true, managerMobile: true,
                outlets: { select: { id: true, name: true, isActive: true } }
            },
            orderBy: { name: "asc" }
        })

        res.json({ success: true, regions })
    } catch (err) {
        console.error("DGM list RTOMs error:", err)
        res.status(500).json({ error: "Failed to fetch RTOMs" })
    }
})

// POST /rtoms - create/assign an RTOM to one of DGM's regions
// This sets the manager details on an existing region
router.post("/rtoms", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const { regionId, name, mobileNumber, email } = req.body
        if (!regionId || !name || !mobileNumber) return res.status(400).json({ error: "regionId, name, and mobileNumber are required" })

        if (!dgm.regionIds.includes(regionId)) return res.status(403).json({ error: "Region not assigned to you" })

        // Check mobile not already in use by another RTOM
        const existing = await prisma.region.findFirst({ where: { managerMobile: mobileNumber, id: { not: regionId } } })
        if (existing) return res.status(400).json({ error: "This mobile number is already used by another RTOM" })

        const region = await prisma.region.update({
            where: { id: regionId },
            data: { managerId: name, managerMobile: mobileNumber, managerEmail: email || null } as any,
            select: { id: true, name: true, managerId: true, managerMobile: true, managerEmail: true }
        })

        // Send welcome email to the new RTOM if they have an email
        if (email) {
            try {
                await emailService.sendManagerWelcomeEmail({
                    managerName: name,
                    managerEmail: email,
                    managerMobile: mobileNumber,
                    regionName: region.name,
                    loginUrl: "https://digital-queue-management-platform.vercel.app/manager/login"
                })
                console.log(`Welcome email sent to RTOM ${name} (${email}) for region ${region.name}`)
            } catch (emailErr) {
                console.error("Failed to send RTOM welcome email (non-fatal):", emailErr)
            }
        }

        res.status(201).json({ success: true, region })
    } catch (err) {
        console.error("DGM create RTOM error:", err)
        res.status(500).json({ error: "Failed to create RTOM" })
    }
})

// PUT /rtoms/:regionId - update an RTOM
router.put("/rtoms/:regionId", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        if (!dgm.regionIds.includes(req.params.regionId)) return res.status(403).json({ error: "Region not assigned to you" })

        const { name, mobileNumber, email } = req.body

        const region = await prisma.region.update({
            where: { id: req.params.regionId },
            data: {
                ...(name && { managerId: name }),
                ...(mobileNumber && { managerMobile: mobileNumber }),
                managerEmail: email !== undefined ? (email || null) : undefined
            } as any,
            select: { id: true, name: true, managerId: true, managerMobile: true, managerEmail: true }
        })

        res.json({ success: true, region })
    } catch (err) {
        console.error("DGM update RTOM error:", err)
        res.status(500).json({ error: "Failed to update RTOM" })
    }
})

// DELETE /rtoms/:regionId - remove RTOM from a region (clears manager fields)
router.delete("/rtoms/:regionId", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        if (!dgm.regionIds.includes(req.params.regionId)) return res.status(403).json({ error: "Region not assigned to you" })

        await prisma.region.update({
            where: { id: req.params.regionId },
            data: { managerId: null, managerMobile: null, managerEmail: null } as any
        })

        res.json({ success: true })
    } catch (err) {
        console.error("DGM remove RTOM error:", err)
        res.status(500).json({ error: "Failed to remove RTOM" })
    }
})

export default router
