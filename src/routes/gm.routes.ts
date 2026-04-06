import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"
import otpService from "../services/otpService"
import emailService from "../services/emailService"
import sltSmsService from "../services/sltSmsService"

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

// Request OTP for GM login
router.post("/request-otp", async (req, res) => {
    try {
        const { mobileNumber } = req.body
        if (!mobileNumber) return res.status(400).json({ error: "Mobile number is required" })

        const gm = await (prisma as any).gM.findFirst({
            where: { mobileNumber, isActive: true },
            select: { id: true, name: true }
        })
        if (!gm) return res.status(404).json({ error: "GM not found with this mobile number" })

        const result = await otpService.generateOTP(mobileNumber, 'gm', gm.name)
        if (!result.success) return res.status(500).json({ error: result.message })

        res.json({ success: true, message: result.message, gmName: gm.name })
    } catch (err) {
        console.error("Request OTP error:", err)
        res.status(500).json({ error: "Failed to send OTP" })
    }
})

// GM Login with OTP
router.post("/login", async (req, res) => {
    try {
        const { mobileNumber, otpCode } = req.body
        if (!mobileNumber || !otpCode) return res.status(400).json({ error: "Mobile number and OTP code are required" })

        const verifyResult = await otpService.verifyOTP(mobileNumber, otpCode, 'gm')
        if (!verifyResult.success) return res.status(401).json({ error: verifyResult.message })

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

        const gm = await (prisma as any).gM.findUnique({ 
            where: { id: auth.gmId },
            select: { 
                id: true, 
                name: true, 
                email: true, 
                mobileNumber: true, 
                isActive: true, 
                regionId: true 
            }
        })
        if (!gm) return res.status(404).json({ error: "GM not found" })

        // Count DGMs under this GM (already correctly filtered)
        const dgmCount = await (prisma as any).dGM.count({ where: { gmId: gm.id } })
        
        // Count regions assigned to this GM (should be 1 or 0)
        const regionCount = gm.regionId ? 1 : 0
        
        // Count outlets in GM's assigned region only
        const outletCount = gm.regionId 
            ? await prisma.outlet.count({ where: { regionId: gm.regionId } })
            : 0

        res.json({ 
            gm: { 
                id: gm.id, 
                name: gm.name, 
                email: gm.email, 
                mobileNumber: gm.mobileNumber, 
                isActive: gm.isActive, 
                dgmCount, 
                regionCount, 
                outletCount 
            } 
        })
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

        // Get GM's assigned region to enforce regional filtering
        const gm = await prisma.gM.findUnique({
            where: { id: auth.gmId },
            select: { regionId: true }
        })
        
        if (!gm || !gm.regionId) {
            return res.status(403).json({ error: "GM region not assigned" })
        }

        const { page = "1", limit = "15", rating, startDate, endDate, outletId, regionId } = req.query
        const pageNum = Math.max(1, parseInt(page as string))
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
        const skip = (pageNum - 1) * limitNum

        // Get outlets in GM's region only
        const outletsInGmRegion = await prisma.outlet.findMany({ 
            where: { regionId: gm.regionId }, 
            select: { id: true } 
        })
        const gmOutletIds = outletsInGmRegion.map((o: any) => o.id)
        
        if (gmOutletIds.length === 0) {
            return res.json({ feedbacks: [], total: 0, page: pageNum, totalPages: 0 })
        }

        const where: any = {}
        if (rating && rating !== "") where.rating = parseInt(rating as string)
        if (startDate && endDate) where.createdAt = { gte: new Date(startDate as string), lte: new Date(endDate as string) }
        
        // Apply outlet/region filtering within GM's region
        if (outletId) {
            // Only allow if outlet is in GM's region
            if (gmOutletIds.includes(outletId as string)) {
                where.token = { outletId: outletId as string }
            } else {
                return res.status(403).json({ error: "Access denied to outlet outside your region" })
            }
        } else if (regionId) {
            // Only allow if regionId matches GM's assigned region
            if (regionId === gm.regionId) {
                where.token = { outletId: { in: gmOutletIds } }
            } else {
                return res.status(403).json({ error: "Access denied to region outside your assignment" })
            }
        } else {
            // Default: show feedbacks from all outlets in GM's region
            where.token = { outletId: { in: gmOutletIds } }
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

// GET /closure-notices - Only closure notices for outlets in GM's region
router.get("/closure-notices", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        // Get GM's assigned region to enforce regional filtering
        const gm = await prisma.gM.findUnique({
            where: { id: auth.gmId },
            select: { regionId: true }
        })
        
        if (!gm || !gm.regionId) {
            return res.status(403).json({ error: "GM region not assigned" })
        }

        // Get outlets in GM's region only
        const outletsInGmRegion = await prisma.outlet.findMany({ 
            where: { regionId: gm.regionId }, 
            select: { id: true } 
        })
        const gmOutletIds = outletsInGmRegion.map((o: any) => o.id)

        const notices = await (prisma as any).closureNotice.findMany({
            where: { outletId: { in: gmOutletIds } },
            include: { outlet: { select: { name: true, region: { select: { name: true } } } } },
            orderBy: { createdAt: "desc" }
        })

        res.json({ notices })
    } catch (err) {
        console.error("GM closure notices error:", err)
        res.status(500).json({ error: "Failed to fetch closure notices" })
    }
})

// POST /closure-notices - create a closure notice for outlets in GM's region only
router.post("/closure-notices", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        // Get GM's assigned region to enforce regional filtering
        const gm = await prisma.gM.findUnique({
            where: { id: auth.gmId },
            select: { regionId: true }
        })
        
        if (!gm || !gm.regionId) {
            return res.status(403).json({ error: "GM region not assigned" })
        }

        const { outletId, title, message, startsAt, endsAt, noticeType, isRecurring, recurringType, recurringDays, recurringEndDate } = req.body
        if (!outletId || !title || !message || !startsAt || !endsAt)
            return res.status(400).json({ error: "outletId, title, message, startsAt, and endsAt are required" })

        // Verify outlet exists and is in GM's region
        const outlet = await prisma.outlet.findFirst({ 
            where: { id: outletId, regionId: gm.regionId } 
        })
        if (!outlet) {
            return res.status(403).json({ error: "Outlet not found or not in your assigned region" })
        }

        if (!isRecurring && new Date(startsAt) >= new Date(endsAt))
            return res.status(400).json({ error: "endsAt must be after startsAt" })

        const type = noticeType === "standard" ? "standard" : "closure"
        const notice = await (prisma as any).closureNotice.create({
            data: {
                outletId, title, message,
                startsAt: new Date(startsAt), endsAt: new Date(endsAt),
                createdBy: "gm", createdById: auth.gmId,
                noticeType: type,
                isRecurring: Boolean(isRecurring),
                recurringType: isRecurring ? (recurringType || "weekly") : null,
                recurringDays: isRecurring && Array.isArray(recurringDays) ? recurringDays : [],
                recurringEndDate: recurringEndDate ? new Date(recurringEndDate) : null,
            }
        })

        res.json({ success: true, notice })
    } catch (err) {
        console.error("GM create closure notice error:", err)
        res.status(500).json({ error: "Failed to create closure notice" })
    }
})

// PUT /closure-notices/:id - update a closure notice (only for outlets in GM's region)
router.put("/closure-notices/:id", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        // Get GM's assigned region to enforce regional filtering
        const gm = await prisma.gM.findUnique({
            where: { id: auth.gmId },
            select: { regionId: true }
        })
        
        if (!gm || !gm.regionId) {
            return res.status(403).json({ error: "GM region not assigned" })
        }

        // Verify notice exists and outlet is in GM's region
        const notice = await (prisma as any).closureNotice.findUnique({ 
            where: { id: req.params.id },
            include: { outlet: { select: { regionId: true } } }
        })
        
        if (!notice) {
            return res.status(404).json({ error: "Notice not found" })
        }
        
        if (notice.outlet.regionId !== gm.regionId) {
            return res.status(403).json({ error: "Access denied to notice outside your region" })
        }

        const { title, message, startsAt, endsAt, noticeType, isRecurring, recurringType, recurringDays, recurringEndDate } = req.body
        const type = noticeType === "standard" ? "standard" : "closure"
        const updated = await (prisma as any).closureNotice.update({
            where: { id: req.params.id },
            data: {
                title, message,
                startsAt: new Date(startsAt),
                endsAt: new Date(endsAt),
                noticeType: type,
                isRecurring: Boolean(isRecurring),
                recurringType: isRecurring ? (recurringType || "weekly") : null,
                recurringDays: isRecurring && Array.isArray(recurringDays) ? recurringDays : [],
                recurringEndDate: recurringEndDate ? new Date(recurringEndDate) : null,
            }
        })
        res.json({ success: true, notice: updated })
    } catch (err) {
        console.error("GM update closure notice error:", err)
        res.status(500).json({ error: "Failed to update closure notice" })
    }
})

// DELETE /closure-notices/:id - delete a closure notice (only for outlets in GM's region)
router.delete("/closure-notices/:id", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        // Get GM's assigned region to enforce regional filtering
        const gm = await prisma.gM.findUnique({
            where: { id: auth.gmId },
            select: { regionId: true }
        })
        
        if (!gm || !gm.regionId) {
            return res.status(403).json({ error: "GM region not assigned" })
        }

        // Verify notice exists and outlet is in GM's region
        const notice = await (prisma as any).closureNotice.findUnique({ 
            where: { id: req.params.id },
            include: { outlet: { select: { regionId: true } } }
        })
        
        if (!notice) {
            return res.status(404).json({ error: "Notice not found" })
        }
        
        if (notice.outlet.regionId !== gm.regionId) {
            return res.status(403).json({ error: "Access denied to notice outside your region" })
        }

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
            include: {
                province: {
                    select: { id: true, name: true, regionId: true }
                }
            },
            orderBy: { createdAt: "desc" }
        })

        res.json({ success: true, dgms })
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

        // Send notifications
        const loginUrl = `${process.env.FRONTEND_BASE_URL || 'https://sltsecmanage.slt.lk:7443'}/dgm/login`

        // Email
        if (email) {
            emailService.sendStaffWelcomeEmail({
                name,
                email,
                mobileNumber,
                role: "DGM",
                loginUrl
            }).catch(err => console.error("DGM welcome email failed:", err))
        }

        // SMS
        sltSmsService.sendStaffWelcomeSMS(mobileNumber, {
            name,
            role: "DGM",
            loginUrl
        }).catch(err => console.error("DGM welcome SMS failed:", err))

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

        // Get GM with region information
        const gm = await (prisma as any).gM.findUnique({
            where: { id: auth.gmId },
            include: { 
                region: {
                    include: {
                        outlets: { select: { id: true, name: true, location: true, isActive: true } }
                    }
                }
            }
        })

        if (!gm || !gm.region) {
            return res.status(404).json({ error: "GM region not found" })
        }

        // Return only the GM's region
        res.json({ success: true, regions: [gm.region] })
    } catch (err) {
        console.error("GM regions error:", err)
        res.status(500).json({ error: "Failed to fetch regions" })
    }
})

// GET /outlets - Get all teleshop outlets in GM's region
router.get("/outlets", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        // Get GM with region information
        const gm = await (prisma as any).gM.findUnique({
            where: { id: auth.gmId },
            include: { region: true }
        })

        if (!gm || !gm.regionId) {
            return res.status(404).json({ error: "GM region not found" })
        }

        // Get all outlets in the GM's region
        const outlets = await prisma.outlet.findMany({
            where: { 
                regionId: gm.regionId,
                isActive: true 
            },
            select: {
                id: true,
                name: true,
                location: true,
                isActive: true,
                region: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        })

        // Transform to match frontend expectations
        const formattedOutlets = outlets.map(outlet => ({
            id: outlet.id,
            name: outlet.name,
            regionName: outlet.region.name
        }))

        res.json({ success: true, outlets: formattedOutlets })
    } catch (err) {
        console.error("GM outlets error:", err)
        res.status(500).json({ error: "Failed to fetch outlets" })
    }
})

// GET /analytics- Analytics for GMs (province-wise access)
router.get("/analytics", async (req, res) => {
    try {
        const auth = verifyGMToken(req)
        if (!auth) return res.status(401).json({ error: "GM authentication required" })

        // Get GM's assigned region to enforce regional filtering
        const gm = await prisma.gM.findUnique({
            where: { id: auth.gmId },
            select: { regionId: true }
        })
        
        if (!gm || !gm.regionId) {
            return res.status(403).json({ error: "GM region not assigned" })
        }

        const { startDate, endDate, provinceId, outletId } = req.query
        console.log('GM Analytics request:', { startDate, endDate, provinceId, outletId })

        // Get outlets in GM's region only
        let gmOutletIds: string[]
        
        if (outletId) {
            // If specific outlet requested, verify it's in GM's region
            const specificOutlet = await prisma.outlet.findFirst({
                where: { 
                    id: outletId as string,
                    regionId: gm.regionId 
                },
                select: { id: true }
            })
            
            if (!specificOutlet) {
                return res.status(403).json({ 
                    error: "Outlet not found or not in your assigned region" 
                })
            }
            
            gmOutletIds = [specificOutlet.id]
        } else if (provinceId) {
            // If provinceId is provided, ensure it's within GM's region and get outlets from that province
            const outletsInProvince = await prisma.outlet.findMany({
                where: { 
                    provinceId: provinceId as string,
                    regionId: gm.regionId  // Only provinces within GM's region
                },
                select: { id: true }
            })
            
            if (outletsInProvince.length === 0) {
                return res.status(403).json({ 
                    error: "Province not found or not within your assigned region" 
                })
            }
            
            gmOutletIds = outletsInProvince.map(outlet => outlet.id)
        } else {
            // Default: get all outlets in GM's region
            const outletsInGmRegion = await prisma.outlet.findMany({ 
                where: { regionId: gm.regionId }, 
                select: { id: true } 
            })
            gmOutletIds = outletsInGmRegion.map(outlet => outlet.id)
        }

        const where: any = {
            status: "completed",
            outletId: { in: gmOutletIds },
            completedAt: {
                gte: startDate ? new Date(startDate as string) : undefined,
                lte: endDate ? new Date(endDate as string) : undefined,
            }
        }

        console.log('GM Query where clause:', where)

        // Total completed tokens
        const totalTokens = await prisma.token.count({
            where: {
                ...where,
                status: "completed",
            }
        })
        console.log('GM Total tokens found:', totalTokens)

        // Average waiting time
        const completedTokens = await prisma.token.findMany({
            where: {
                ...where,
                status: "completed",
                startedAt: { not: undefined },
                createdAt: { not: undefined },
            },
        })
        console.log('GM Completed tokens found for avg calculation:', completedTokens.length)

        const avgWaitTime =
            completedTokens.length > 0
                ? completedTokens.reduce((sum, token) => {
                    const wait =
                        token.startedAt && token.createdAt
                            ? (token.startedAt.getTime() - token.createdAt.getTime()) / 1000 / 60
                            : 0
                    return sum + wait
                }, 0) / completedTokens.length
                : 0

        // Average service time
        const avgServiceTime =
            completedTokens.length > 0
                ? completedTokens.reduce((sum, token) => {
                    const service =
                        token.completedAt && token.startedAt
                            ? (token.completedAt.getTime() - token.startedAt.getTime()) / 1000 / 60
                            : 0
                    return sum + service
                }, 0) / completedTokens.length
                : 0

        // Feedback stats
        const feedbackStats = await prisma.feedback.groupBy({
            by: ["rating"],
            where: {
                token: {
                    ...where,
                    status: "completed"
                }
            },
            _count: true,
        })

        // Officer performance
        const officerPerformance = await prisma.token.groupBy({
            by: ["assignedTo"],
            where: {
                ...where,
                status: "completed",
                assignedTo: { not: null },
            },
            _count: true,
        })

        const officerDetails = await Promise.all(
            officerPerformance.map(async (perf) => {
                const officer = await prisma.officer.findUnique({
                    where: { id: perf.assignedTo! },
                    include: { outlet: true },
                })

                const feedbacks = await prisma.feedback.findMany({
                    where: {
                        token: {
                            assignedTo: perf.assignedTo!,
                            createdAt: where.createdAt,
                        },
                    },
                })

                const avgRating = feedbacks.length > 0 ? feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length : 0

                return {
                    officer,
                    tokensHandled: perf._count,
                    avgRating,
                    feedbackCount: feedbacks.length,
                }
            }),
        )

        // Generate hourly waiting times (8 AM to 6 PM)
        const hourlyWaitingTimes = []
        for (let hour = 8; hour <= 18; hour++) {
            const hourStart = new Date(startDate ? new Date(startDate as string) : new Date())
            hourStart.setHours(hour, 0, 0, 0)
            const hourEnd = new Date(hourStart)
            hourEnd.setHours(hour, 59, 59, 999)

            const hourTokens = completedTokens.filter(token => {
                if (!token.startedAt) return false
                const startedTime = new Date(token.startedAt)
                return startedTime >= hourStart && startedTime <= hourEnd
            })

            const avgHourWaitTime = hourTokens.length > 0
                ? hourTokens.reduce((sum, token) => {
                    const wait = token.startedAt && token.createdAt
                        ? (token.startedAt.getTime() - token.createdAt.getTime()) / 1000 / 60
                        : 0
                    return sum + wait
                }, 0) / hourTokens.length
                : 0

            hourlyWaitingTimes.push({
                hour: `${hour.toString().padStart(2, '0')}:00`,
                waitTime: Math.round(avgHourWaitTime * 10) / 10
            })
        }

        // Generate service types data
        const serviceTypes = await prisma.token.groupBy({
            by: ["serviceTypes"],
            where: {
                ...where,
                status: "completed",
            },
            _count: true,
        })

        const serviceTypesFormatted = serviceTypes.map(service => {
            const serviceTypeArray = Array.isArray(service.serviceTypes) ? service.serviceTypes : [];
            const firstServiceType = serviceTypeArray.length > 0 ? serviceTypeArray[0] : "other";

            return {
                name: firstServiceType,
                count: service._count
            };
        })

        res.json({
            totalTokens,
            avgWaitTime: Math.round(avgWaitTime * 10) / 10,
            avgServiceTime: Math.round(avgServiceTime * 10) / 10,
            feedbackStats,
            officerPerformance: officerDetails,
            hourlyWaitingTimes,
            serviceTypes: serviceTypesFormatted,
        })
    } catch (error) {
        console.error("GM Analytics error:", error)
        res.status(500).json({ error: "Failed to fetch analytics" })
    }
})

// ====== NEW PROVINCE-BASED DGM MANAGEMENT ======

// Get provinces in GM's region
router.get("/provinces", async (req, res) => {
  try {
    const auth = verifyGMToken(req)
    if (!auth) return res.status(401).json({ error: "GM authentication required" })

    // Get GM with region information
    const gm = await (prisma as any).gM.findUnique({
      where: { id: auth.gmId },
      include: { region: true }
    })

    if (!gm || !gm.regionId) {
      return res.status(404).json({ error: "GM region not found" })
    }

    const provinces = await (prisma as any).province.findMany({
      where: { regionId: gm.regionId },
      include: {
        dgm: {
          select: { 
            id: true, 
            name: true, 
            mobileNumber: true, 
            email: true,
            isActive: true,
            lastLoginAt: true
          }
        }
      },
      orderBy: { name: 'asc' }
    })

    res.json({
      success: true,
      region: gm.region,
      provinces
    })
  } catch (error) {
    console.error("Get provinces error:", error)
    res.status(500).json({ error: "Failed to fetch provinces" })
  }
})

// Create DGM and assign to province (NEW VERSION)
router.post("/dgms/province-assignment", async (req, res) => {
  try {
    const auth = verifyGMToken(req)
    if (!auth) return res.status(401).json({ error: "GM authentication required" })

    const { name, mobileNumber, email, provinceId } = req.body

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "DGM name is required" })
    }

    if (!mobileNumber) {
      return res.status(400).json({ error: "Valid Sri Lankan mobile number is required" })
    }

    if (!provinceId) {
      return res.status(400).json({ error: "Province assignment is required" })
    }

    // Get GM with region
    const gm = await (prisma as any).gM.findUnique({
      where: { id: auth.gmId },
      include: { region: true }
    })

    if (!gm || !gm.regionId) {
      return res.status(404).json({ error: "GM region not found" })
    }

    // Verify province belongs to GM's region and doesn't have DGM
    const province = await (prisma as any).province.findUnique({
      where: { id: provinceId },
      include: { dgm: true }
    })

    if (!province || province.regionId !== gm.regionId) {
      return res.status(400).json({ error: "Invalid province or not in your region" })
    }

    if (province.dgm) {
      return res.status(400).json({ error: "This province already has a DGM assigned" })
    }

    // Check if mobile number already exists
    const existingDGM = await (prisma as any).dGM.findUnique({
      where: { mobileNumber }
    })

    if (existingDGM) {
      return res.status(400).json({ error: "DGM with this mobile number already exists" })
    }

    // Generate temporary password (for now, using simple method)
    const tempPassword = Math.random().toString(36).slice(-8)

    const dgm = await (prisma as any).dGM.create({
      data: {
        name: name.trim(),
        mobileNumber,
        email: email?.trim() || null,
        gmId: gm.id,
        provinceId,
        regionIds: [province.regionId], // For backward compatibility
        isActive: true
      },
      include: {
        province: {
          select: { id: true, name: true }
        }
      }
    })

    res.json({
      success: true,
      dgm: {
        id: dgm.id,
        name: dgm.name,
        mobileNumber: dgm.mobileNumber,
        email: dgm.email,
        province: dgm.province,
        isActive: dgm.isActive
      },
      message: `DGM created and assigned to ${province.name} province. Login credentials will be sent via SMS.`
    })
  } catch (error) {
    console.error("Create DGM with province error:", error)
    res.status(500).json({ error: "Failed to create DGM" })
  }
})

export default router
