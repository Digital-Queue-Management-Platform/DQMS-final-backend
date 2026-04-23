import { Router } from 'express'
import * as jwt from 'jsonwebtoken'
import { prisma } from '../server'
import emailService from '../services/emailService'
import sltSmsService from '../services/sltSmsService'
import { isValidSLMobile, isValidEmail, isValidName } from '../utils/validators'
import otpService from "../services/otpService"

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

// Request OTP for DGM login
router.post("/request-otp", async (req, res) => {
    try {
        const { mobileNumber } = req.body
        if (!mobileNumber) return res.status(400).json({ error: "Mobile number is required" })

        const dgm = await (prisma as any).dGM.findFirst({
            where: { mobileNumber, isActive: true },
            select: { id: true, name: true }
        })
        if (!dgm) return res.status(404).json({ error: "DGM not found with this mobile number" })

        const result = await otpService.generateOTP(mobileNumber, 'dgm', dgm.name)
        if (!result.success) return res.status(500).json({ error: result.message })

        res.json({ success: true, message: result.message, dgmName: dgm.name })
    } catch (err) {
        console.error("Request OTP error:", err)
        res.status(500).json({ error: "Failed to send OTP" })
    }
})

// DGM Login with OTP
router.post("/login", async (req, res) => {
    try {
        const { mobileNumber, otpCode } = req.body
        if (!mobileNumber || !otpCode) return res.status(400).json({ error: "Mobile number and OTP code are required" })

        const verifyResult = await otpService.verifyOTP(mobileNumber, otpCode, 'dgm')
        if (!verifyResult.success) return res.status(401).json({ error: verifyResult.message })

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

        const { outletId, title, message, startsAt, endsAt, noticeType, isRecurring, recurringType, recurringDays, recurringEndDate } = req.body
        if (!outletId || !title || !message || !startsAt || !endsAt)
            return res.status(400).json({ error: "outletId, title, message, startsAt, and endsAt are required" })

        const outlet = await prisma.outlet.findFirst({ where: { id: outletId, regionId: { in: dgm.regionIds } } })
        if (!outlet) return res.status(403).json({ error: "Outlet not in your regions" })

        const type = noticeType === "standard" ? "standard" : "closure"
        const notice = await (prisma as any).closureNotice.create({
            data: {
                outletId, title, message,
                startsAt: new Date(startsAt), endsAt: new Date(endsAt),
                createdBy: "dgm", createdById: auth.dgmId,
                noticeType: type,
                isRecurring: Boolean(isRecurring),
                recurringType: isRecurring ? (recurringType || "weekly") : null,
                recurringDays: isRecurring && Array.isArray(recurringDays) ? recurringDays : [],
                recurringEndDate: recurringEndDate ? new Date(recurringEndDate) : null
            }
        })

        res.json({ success: true, notice })
    } catch (err) {
        console.error("DGM create closure notice error:", err)
        res.status(500).json({ error: "Failed to create closure notice" })
    }
})

// PUT /closure-notices/:id
router.put("/closure-notices/:id", async (req, res) => {
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
        console.error("DGM update closure notice error:", err)
        res.status(500).json({ error: "Failed to update closure notice" })
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

// GET /rtoms - list all RTOM managers in DGM's assigned regions (updated for new hierarchy)
router.get("/rtoms", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        // Get regions assigned to this DGM
        const regions = await prisma.region.findMany({
            where: { id: { in: dgm.regionIds } },
            include: {
                rtoms: {
                    where: { dgmId: auth.dgmId }, // Only RTOMs assigned to this DGM
                    include: {
                        teleshopManagers: {
                            select: {
                                id: true,
                                name: true,
                                mobileNumber: true,
                                isActive: true,
                                branchId: true
                            }
                        }
                    }
                },
                outlets: {
                    select: {
                        id: true,
                        name: true,
                        isActive: true
                    }
                }
            }
        })

        // Transform to properly support multiple RTOMs per DGM
        const transformedRegions = regions.map(region => ({
            id: region.id,
            name: region.name,
            outlets: region.outlets,
            rtoms: region.rtoms.map(rtom => ({
                id: rtom.id,
                name: rtom.name,
                email: rtom.email,
                mobileNumber: rtom.mobileNumber,
                isActive: rtom.isActive,
                lastLoginAt: rtom.lastLoginAt,
                createdAt: rtom.createdAt,
                teleshopManagers: rtom.teleshopManagers
            }))
        }))

        res.json({ success: true, regions: transformedRegions })
    } catch (err) {
        console.error("DGM list RTOMs error:", err)
        res.status(500).json({ error: "Failed to fetch RTOMs" })
    }
})

// POST /rtoms - create/assign an RTOM to one of DGM's regions (updated for new hierarchy)
router.post("/rtoms", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const { regionId, name, mobileNumber, email, assignedOutletIds } = req.body
        if (!regionId || !name || !mobileNumber) return res.status(400).json({ error: "regionId, name, and mobileNumber are required" })
        if (!isValidName(name)) return res.status(400).json({ error: "Name must be between 2 and 100 characters" })
        if (!isValidSLMobile(mobileNumber)) return res.status(400).json({ error: "Invalid mobile number. Must be a valid Sri Lankan number (e.g. 0771234567)" })
        if (email && !isValidEmail(email)) return res.status(400).json({ error: "Invalid email address format" })

        if (!dgm.regionIds.includes(regionId)) return res.status(403).json({ error: "Region not assigned to you" })

        // Check mobile not already in use by another RTOM
        const existing = await prisma.rTOM.findUnique({ where: { mobileNumber } })
        if (existing) return res.status(400).json({ error: "This mobile number is already used by another RTOM" })

        // Create new RTOM entity
        const rtom = await prisma.rTOM.create({
            data: {
                name,
                mobileNumber,
                email: email || null,
                dgmId: auth.dgmId,
                regionId
            },
            include: {
                region: { select: { id: true, name: true } }
            }
        })

        // Handle outlet assignments through TeleshopManager relationships
        // Note: This requires TeleshopManagers to exist for the outlets first
        if (assignedOutletIds && Array.isArray(assignedOutletIds) && assignedOutletIds.length > 0) {
            // Validate that all outlet IDs exist and belong to the specified region
            const outlets = await prisma.outlet.findMany({
                where: {
                    id: { in: assignedOutletIds },
                    regionId: regionId
                }
            })
            
            if (outlets.length !== assignedOutletIds.length) {
                await prisma.rTOM.delete({ where: { id: rtom.id } }) // Rollback RTOM creation
                return res.status(400).json({ error: "Some outlet IDs are invalid or don't belong to this region" })
            }

            // Find existing TeleshopManagers for these outlets and assign them to this RTOM
            const managersToAssign = await prisma.teleshopManager.findMany({
                where: {
                    branchId: { in: assignedOutletIds },
                    regionId: regionId
                }
            })

            if (managersToAssign.length > 0) {
                // Update existing TeleshopManagers to report to this RTOM
                await prisma.teleshopManager.updateMany({
                    where: {
                        id: { in: managersToAssign.map(m => m.id) }
                    },
                    data: {
                        rtomId: rtom.id
                    }
                })
            }

            // For outlets without TeleshopManagers, create a note (but don't create fake managers)
        const outletsWithManagers = managersToAssign.map(m => m.branchId)
        const outletsWithoutManagers = assignedOutletIds.filter(id => !outletsWithManagers.includes(id))
        
        if (outletsWithoutManagers.length > 0) {
            console.log(`Note: ${outletsWithoutManagers.length} outlets assigned to RTOM ${rtom.name} don't have TeleshopManagers yet`)
        }

        // Update Outlet.rtomId for consistency
        await prisma.outlet.updateMany({
            where: { id: { in: assignedOutletIds } },
            data: { rtomId: rtom.id }
        })
    }

    // Send notifications
    const loginUrl = `${process.env.FRONTEND_BASE_URL || 'https://sltsecmanage.slt.lk:7443'}/manager/login`

    // Email
    if (email) {
        emailService.sendStaffWelcomeEmail({
            name,
            email,
            mobileNumber,
            role: "RTOM",
            regionName: rtom.region.name,
            loginUrl
        }).catch(err => console.error("RTOM welcome email failed:", err))
    }

    // SMS
    sltSmsService.sendStaffWelcomeSMS(mobileNumber, {
        name,
        role: "RTOM",
        loginUrl
    }).catch(err => console.error("RTOM welcome SMS failed:", err))

    // Return RTOM with backward-compatible format
    const response = {
        id: rtom.region.id, // regionId for frontend compatibility
        name: rtom.region.name,
        managerId: rtom.id,
        managerEmail: rtom.email,
        managerMobile: rtom.mobileNumber,
        managerName: rtom.name,
        rtom: rtom
    }

    res.status(201).json({ success: true, region: response, rtom })
} catch (err) {
    console.error("DGM create RTOM error:", err)
    res.status(500).json({ error: "Failed to create RTOM" })
}
})

// PUT /rtoms/:id - Combined route for updating RTOMs and legacy Region manager fields
router.put("/rtoms/:id", async (req, res) => {
try {
    const auth = verifyDGMToken(req)
    if (!auth) return res.status(401).json({ error: "DGM authentication required" })

    const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
    if (!dgm) return res.status(404).json({ error: "DGM not found" })

    const { id } = req.params
    const { name, mobileNumber, email, assignedOutletIds } = req.body

    // 1. Try to find if this is an RTOM record
    const existingRTOM = await prisma.rTOM.findUnique({
        where: { id },
        include: { region: true }
    })

    if (existingRTOM) {
        // --- RTOM MODEL UPDATE ---
        // Verify DGM has access to this region
        if (!dgm.regionIds.includes(existingRTOM.regionId)) {
            return res.status(403).json({ error: "This RTOM belongs to a region you don't manage" })
        }

        // Validate input
        if (name && !isValidName(name)) return res.status(400).json({ error: "Name must be between 2 and 100 characters" })
        if (mobileNumber && !isValidSLMobile(mobileNumber)) return res.status(400).json({ error: "Invalid mobile number format" })
        if (email && !isValidEmail(email)) return res.status(400).json({ error: "Invalid email address format" })

        // Check if mobile number is already in use by another RTOM (if changing)
        if (mobileNumber && mobileNumber !== existingRTOM.mobileNumber) {
            const existing = await prisma.rTOM.findUnique({ where: { mobileNumber } })
            if (existing) return res.status(400).json({ error: "This mobile number is already used by another RTOM" })
        }

        // Update the RTOM
        const updatedRTOM = await prisma.rTOM.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(mobileNumber && { mobileNumber }),
                email: email !== undefined ? (email || null) : undefined
            }
        })

        // Handle outlet assignment updates
        if (assignedOutletIds && Array.isArray(assignedOutletIds)) {
            // Validate all outlet IDs belong to the RTOM's region
            if (assignedOutletIds.length > 0) {
                const outlets = await prisma.outlet.findMany({
                    where: {
                        id: { in: assignedOutletIds },
                        regionId: existingRTOM.regionId
                    }
                })
                
                if (outlets.length !== assignedOutletIds.length) {
                    return res.status(400).json({ error: "Some outlet IDs are invalid or don't belong to this region" })
                }
            }

            // Update TeleshopManagers
            await prisma.teleshopManager.updateMany({
                where: { rtomId: id },
                data: { rtomId: null }
            })

            if (assignedOutletIds.length > 0) {
                await prisma.teleshopManager.updateMany({
                    where: {
                        branchId: { in: assignedOutletIds },
                        regionId: existingRTOM.regionId
                    },
                    data: { rtomId: id }
                })
            }

            // Update Outlets (rtomId field)
            await prisma.outlet.updateMany({
                where: { rtomId: id },
                data: { rtomId: null }
            })

            if (assignedOutletIds.length > 0) {
                await prisma.outlet.updateMany({
                    where: { id: { in: assignedOutletIds } },
                    data: { rtomId: id }
                })
            }
        }

        return res.json({ success: true, rtom: updatedRTOM })
    }

    // 2. Try to find if this is a Region record (Legacy support)
    const region = await prisma.region.findUnique({ where: { id } })
    if (region) {
        if (!dgm.regionIds.includes(id)) return res.status(403).json({ error: "Region not assigned to you" })

        const updatedRegion = await prisma.region.update({
            where: { id },
            data: {
                ...(name && { managerId: name }),
                ...(mobileNumber && { managerMobile: mobileNumber }),
                managerEmail: email !== undefined ? (email || null) : undefined
            } as any,
            select: { id: true, name: true, managerId: true, managerMobile: true, managerEmail: true }
        })

        return res.json({ success: true, region: updatedRegion })
    }

    return res.status(404).json({ error: "RTOM or Region not found" })
} catch (err) {
    console.error("DGM update error:", err)
    res.status(500).json({ error: "Failed to update" })
}
})


// DELETE /rtoms/:id - Combined route for removing RTOM records and legacy Region manager fields
router.delete("/rtoms/:id", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const { id } = req.params

        // 1. Try to find if this is an RTOM record
        const existingRTOM = await prisma.rTOM.findUnique({ where: { id } })
        if (existingRTOM) {
            // Verify DGM has access to this region
            if (!dgm.regionIds.includes(existingRTOM.regionId)) {
                return res.status(403).json({ error: "Access denied to this region" })
            }

            // Clear references in TeleshopManagers and Outlets
            await prisma.teleshopManager.updateMany({
                where: { rtomId: id },
                data: { rtomId: null }
            })
            await prisma.outlet.updateMany({
                where: { rtomId: id },
                data: { rtomId: null }
            })

            // Delete the RTOM record
            await prisma.rTOM.delete({ where: { id } })
            return res.json({ success: true, message: "RTOM deleted successfully" })
        }

        // 2. Try to find if this is a Region record (Legacy support)
        const region = await prisma.region.findUnique({ where: { id } })
        if (region) {
            if (!dgm.regionIds.includes(id)) return res.status(403).json({ error: "Region not assigned to you" })

            await prisma.region.update({
                where: { id },
                data: { managerId: null, managerMobile: null, managerEmail: null } as any
            })

            return res.json({ success: true, message: "Region manager cleared" })
        }

        return res.status(404).json({ error: "RTOM or Region not found" })
    } catch (err) {
        console.error("DGM remove RTOM error:", err)
        res.status(500).json({ error: "Failed to remove RTOM" })
    }
})


// GET /analytics - Analytics for DGMs (region-scoped access)
router.get("/analytics", async (req, res) => {
    try {
        const auth = verifyDGMToken(req)
        if (!auth) return res.status(401).json({ error: "DGM authentication required" })

        const dgm = await (prisma as any).dGM.findUnique({ where: { id: auth.dgmId } })
        if (!dgm) return res.status(404).json({ error: "DGM not found" })

        const { startDate, endDate, outletId } = req.query
        console.log('DGM Analytics request:', { startDate, endDate, outletId })

        // Verify DGM has access to this outlet (must be in their regions)
        if (outletId) {
            const outlet = await prisma.outlet.findUnique({ where: { id: outletId as string }, select: { regionId: true } })
            if (!outlet || !dgm.regionIds.includes(outlet.regionId)) {
                return res.status(403).json({ error: "Access denied to this outlet" })
            }
        }

        const where: any = {
            status: "completed",
            completedAt: {
                gte: startDate ? new Date(startDate as string) : undefined,
                lte: endDate ? new Date(endDate as string) : undefined,
            }
        }

        if (outletId) {
            where.outletId = outletId
        }

        console.log('DGM Query where clause:', where)

        // Total completed tokens
        const totalTokens = await prisma.token.count({
            where: {
                ...where,
                status: "completed",
            }
        })
        console.log('DGM Total tokens found:', totalTokens)

        // Average waiting time
        const completedTokens = await prisma.token.findMany({
            where: {
                ...where,
                status: "completed",
                startedAt: { not: undefined },
                createdAt: { not: undefined },
            },
        })
        console.log('DGM Completed tokens found for avg calculation:', completedTokens.length)

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
        console.error("DGM Analytics error:", error)
        res.status(500).json({ error: "Failed to fetch analytics" })
    }
})

export default router
