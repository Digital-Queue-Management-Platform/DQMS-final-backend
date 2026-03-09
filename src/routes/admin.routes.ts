import { Router } from "express"
import * as jwt from "jsonwebtoken"
import * as bcrypt from "bcrypt"
import { prisma } from "../server"
import emailService from "../services/emailService"
import sltSmsService from "../services/sltSmsService"
import { generateSecurePassword } from "../utils/passwordGenerator"
import { isValidSLMobile, isValidEmail, isValidName } from "../utils/validators"
import { healthTracker } from "../services/healthTracker"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
// No expiration for production system - admin needs continuous access
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined
const ADMIN_EMAIL = "adminqms@slt.lk"
const ADMIN_PASSWORD = "ABcd123#"

// Interface for manager credentials
interface ManagerCredentials {
  email: string
  temporaryPassword: string
  message: string
  emailSent?: boolean
}

// Admin authentication middleware
const authenticateAdmin = (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Access denied. No token provided." })
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix

    const decoded = (jwt as any).verify(token, JWT_SECRET as jwt.Secret)

    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin role required." })
    }

    req.user = decoded
    next()
  } catch (error) {
    res.status(401).json({ error: "Invalid token." })
  }
}

// Admin login endpoint (no authentication required)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    // Validate credentials against hardcoded admin credentials
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid email or password" })
    }

    // Generate JWT token (no expiration for production)
    const tokenOptions = {
      email: ADMIN_EMAIL,
      role: "admin",
      type: "admin"
    }

    const signOptions: any = {}
    if (JWT_EXPIRES) {
      signOptions.expiresIn = JWT_EXPIRES
    }

    const token = (jwt as any).sign(
      tokenOptions,
      JWT_SECRET as jwt.Secret,
      signOptions
    )

    res.json({
      token,
      user: {
        email: ADMIN_EMAIL,
        role: "admin"
      }
    })
  } catch (error) {
    console.error("Admin login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Apply authentication middleware to all other admin routes
router.use(authenticateAdmin)

// Get dashboard analytics
router.get("/analytics", async (req, res) => {
  try {
    const { startDate, endDate, outletId } = req.query

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

    // Run independent queries in parallel
    const [totalTokens, completedTokens, feedbackStats, officerPerformance, serviceTypes] = await Promise.all([
      prisma.token.count({ where: { ...where, status: "completed" } }),
      // Only fetch the 3 timestamp fields needed — avoids transferring unused columns
      prisma.token.findMany({
        where: { ...where, status: "completed", startedAt: { not: undefined }, createdAt: { not: undefined } },
        select: { startedAt: true, createdAt: true, completedAt: true },
      }),
      prisma.feedback.groupBy({
        by: ["rating"],
        where: { token: { ...where, status: "completed" } },
        _count: true,
      }),
      prisma.token.groupBy({
        by: ["assignedTo"],
        where: { ...where, status: "completed", assignedTo: { not: null } },
        _count: true,
      }),
      prisma.token.groupBy({
        by: ["serviceTypes"],
        where: { ...where, status: "completed" },
        _count: true,
      }),
    ])

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

    // Batch-fetch all officers and all relevant feedbacks in 2 queries instead of N+N
    const officerIds = officerPerformance.map(p => p.assignedTo!).filter(Boolean)
    const [officerRecords, allFeedbacks] = await Promise.all([
      officerIds.length > 0
        ? prisma.officer.findMany({ where: { id: { in: officerIds } }, include: { outlet: true } })
        : Promise.resolve([]),
      officerIds.length > 0
        ? prisma.feedback.findMany({
            where: { token: { assignedTo: { in: officerIds }, createdAt: where.completedAt } },
            select: { rating: true, token: { select: { assignedTo: true } } }
          })
        : Promise.resolve([]),
    ])
    const officerMap = new Map(officerRecords.map(o => [o.id, o]))
    const feedbacksByOfficer = allFeedbacks.reduce<Map<string, number[]>>((acc, f) => {
      const oid = f.token.assignedTo
      if (oid) { if (!acc.has(oid)) acc.set(oid, []); acc.get(oid)!.push(f.rating) }
      return acc
    }, new Map())

    const officerDetails = officerPerformance.map((perf) => {
      const ratings = feedbacksByOfficer.get(perf.assignedTo!) ?? []
      const avgRating = ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0
      return {
        officer: officerMap.get(perf.assignedTo!) ?? null,
        tokensHandled: perf._count,
        avgRating,
        feedbackCount: ratings.length,
      }
    })

    // Generate hourly waiting times (8 AM to 6 PM) — in-memory from already-fetched data
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

    const serviceTypesFormatted = serviceTypes.map(service => {
      const serviceTypeArray = Array.isArray(service.serviceTypes) ? service.serviceTypes : []
      const firstServiceType = serviceTypeArray.length > 0 ? serviceTypeArray[0] : "other"
      return { name: firstServiceType, count: service._count }
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
    console.error("Analytics error:", error)
    res.status(500).json({ error: "Failed to fetch analytics" })
  }
})

// Get alerts
router.get("/alerts", async (req, res) => {
  try {
    const { isRead, type, severity, outletId, importantOnly } = req.query

    const where: any = {}
    if (isRead !== undefined) {
      where.isRead = isRead === "true"
    }
    if (type) {
      where.type = type as string
    }
    if (severity) {
      where.severity = severity as string
    }

    // initial fetch by simple fields (isRead/type/severity)
    let alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    // If outletId is provided, filter alerts whose relatedEntity token belongs to that outlet
    if (outletId) {
      const tokenIds = alerts.map((a) => a.relatedEntity).filter((x): x is string => !!x)
      if (tokenIds.length > 0) {
        const tokens = await prisma.token.findMany({
          where: { id: { in: tokenIds }, outletId: outletId as string },
          select: { id: true },
        })
        const ok = new Set(tokens.map((t) => t.id))
        alerts = alerts.filter((a) => a.relatedEntity && ok.has(a.relatedEntity))
      } else {
        alerts = []
      }
    }

    if (importantOnly === "true") {
      alerts = alerts.filter((a) => a.severity === "high")
    }

    res.json(alerts)
  } catch (error) {
    console.error("Alerts fetch error:", error)
    res.status(500).json({ error: "Failed to fetch alerts" })
  }
})

// Mark alert as read
router.patch("/alerts/:alertId/read", async (req, res) => {
  try {
    const { alertId } = req.params

    const alert = await prisma.alert.update({
      where: { id: alertId },
      data: { isRead: true },
    })

    res.json({ success: true, alert })
  } catch (error) {
    console.error("Alert update error:", error)
    res.status(500).json({ error: "Failed to update alert" })
  }
})

// Delete alert
router.delete("/alerts/:alertId", async (req, res) => {
  try {
    const { alertId } = req.params

    await prisma.alert.delete({
      where: { id: alertId },
    })

    res.json({ success: true, message: "Alert deleted successfully" })
  } catch (error) {
    console.error("Alert delete error:", error)
    res.status(500).json({ error: "Failed to delete alert" })
  }
})

// Get real-time dashboard
router.get("/dashboard/realtime", async (req, res) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [activeTokens, completedToday, activeOfficers, avgRatingToday] = await Promise.all([
      prisma.token.count({
        where: { createdAt: { gte: today }, status: { in: ["waiting", "in_service"] } },
      }),
      prisma.token.count({
        where: { createdAt: { gte: today }, status: "completed" },
      }),
      prisma.officer.count({
        where: { status: { in: ["available", "serving"] } },
      }),
      prisma.feedback.aggregate({
        where: { createdAt: { gte: today } },
        _avg: { rating: true },
      }),
    ])

    res.json({
      activeTokens,
      completedToday,
      activeOfficers,
      avgRating: avgRatingToday._avg.rating || 0,
    })
  } catch (error) {
    console.error("Dashboard error:", error)
    res.status(500).json({ error: "Failed to fetch dashboard" })
  }
})

// Register a region (name only — RTOM assigned later by DGM)
router.post("/register-region", async (req, res) => {
  try {
    const { name, managerName, managerEmail, managerMobile } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: "Region name is required" })
    if (managerMobile && !isValidSLMobile(managerMobile)) {
      return res.status(400).json({ error: "Invalid mobile number. Must be a valid Sri Lankan number (e.g. 0771234567)" })
    }
    if (managerEmail && !isValidEmail(managerEmail)) {
      return res.status(400).json({ error: "Invalid email address format" })
    }
    if (managerName && !isValidName(managerName)) {
      return res.status(400).json({ error: "Manager name must be between 2 and 100 characters" })
    }

    const region = await prisma.region.create({
      data: {
        name,
        managerId: managerName,
        managerEmail: managerEmail || null,
        managerMobile: managerMobile || null
      } as any
    })

    // Send notifications if RTOM details are provided
    if (managerMobile) {
      const loginUrl = "https://digital-queue-management-platform.vercel.app/manager/login"

      // Email
      if (managerEmail) {
        emailService.sendStaffWelcomeEmail({
          name: managerName || "RTOM",
          email: managerEmail,
          mobileNumber: managerMobile,
          role: "RTOM",
          regionName: name,
          loginUrl
        }).catch(err => console.error("RTOM welcome email failed:", err))
      }

      // SMS
      sltSmsService.sendStaffWelcomeSMS(managerMobile, {
        name: managerName || "RTOM",
        role: "RTOM",
        loginUrl
      }).catch(err => console.error("RTOM welcome SMS failed:", err))
    }

    res.json({ success: true, region })
  } catch (error: any) {
    console.error("Region register error:", error)
    res.status(500).json({ error: "Failed to create region" })
  }
})

// Get all regions
router.get("/regions", async (req, res) => {
  try {
    const regions = await prisma.region.findMany({
      select: { id: true, name: true, managerId: true, managerEmail: true, managerMobile: true, outlets: { select: { id: true, name: true } } },
      orderBy: { name: "asc" }
    })
    res.json({ regions })
  } catch (error: any) {
    console.error("Get regions error:", error)
    res.status(500).json({ error: "Failed to fetch regions" })
  }
})

// Delete a region
router.delete("/regions/:id", async (req, res) => {
  try {
    const { id } = req.params

    const region = await prisma.region.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!region) return res.status(404).json({ error: "Region not found" })

    // Unlink outlets from this region before deleting
    await prisma.outlet.updateMany({ where: { regionId: id }, data: { regionId: null } as any })

    await prisma.region.delete({ where: { id } })
    res.json({ success: true, message: `Region "${region.name}" deleted` })
  } catch (error: any) {
    console.error("Delete region error:", error)
    res.status(500).json({ error: "Failed to delete region" })
  }
})

// Get all regions (used for DGM assignment dropdown and RTOM listing)
router.get("/managers", async (req, res) => {
  try {
    const regions = await prisma.region.findMany({
      select: {
        id: true,
        name: true,
        managerId: true,
        managerEmail: true,
        managerMobile: true,
        createdAt: true,
        outlets: {
          select: {
            id: true,
            name: true,
            location: true,
            isActive: true
          }
        }
      }
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

    res.json({ success: true, managers: enrichedRegions })
  } catch (error) {
    console.error("Get managers error:", error)
    res.status(500).json({ error: "Failed to fetch managers" })
  }
})

// Reset manager password (generates new password and sends email)
router.post("/managers/:regionId/reset-password", async (req, res) => {
  try {
    const { regionId } = req.params

    // Find the manager's region
    const region = await prisma.region.findUnique({
      where: { id: regionId },
      select: {
        id: true,
        name: true,
        managerId: true,
        managerEmail: true,
        managerMobile: true
      }
    })

    if (!region) {
      return res.status(404).json({ error: "RTOM not found" })
    }

    if (!region.managerEmail) {
      return res.status(400).json({ error: "RTOM email not found" })
    }

    // RTOMs use mobile-only login, provide mobile number info
    res.json({
      success: true,
      message: "RTOM uses mobile number login. No password required.",
      loginMethod: "mobile",
      mobileNumber: region.managerMobile,
      instructions: "RTOM can login directly using their mobile number at the RTOM portal."
    })

  } catch (error) {
    console.error("RTOM info retrieval error:", error)
    res.status(500).json({ error: "Failed to retrieve RTOM information" })
  }
})

// Update manager password (manual password setting)
router.put("/managers/:regionId/password", async (req, res) => {
  try {
    const { regionId } = req.params
    const { newPassword } = req.body

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long" })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    const region = await prisma.region.update({
      where: { id: regionId },
      data: { managerPassword: hashedPassword } as any,
      select: {
        id: true,
        name: true,
        managerId: true,
        managerEmail: true
      }
    })

    res.json({
      success: true,
      message: "Manager password updated successfully",
      manager: region
    })
  } catch (error) {
    console.error("Update manager password error:", error)
    res.status(500).json({ error: "Failed to update manager password" })
  }
})

// Update manager details
router.put("/managers/:regionId", async (req, res) => {
  try {
    const { regionId } = req.params
    const { managerName, managerEmail, managerMobile } = req.body

    if (managerEmail) {
      // Check if email is already used by another manager
      const existingRegion = await prisma.region.findFirst({
        where: {
          managerEmail: managerEmail,
          id: { not: regionId }
        }
      })

      if (existingRegion) {
        return res.status(400).json({ error: "Email already in use by another manager" })
      }
    }

    const region = await prisma.region.update({
      where: { id: regionId },
      data: {
        managerId: managerName,
        managerEmail: managerEmail,
        managerMobile: managerMobile
      },
      select: {
        id: true,
        name: true,
        managerId: true,
        managerEmail: true,
        managerMobile: true,
        outlets: {
          select: {
            id: true,
            name: true,
            location: true,
            isActive: true
          }
        }
      }
    })

    res.json({
      success: true,
      message: "Manager details updated successfully",
      manager: region
    })
  } catch (error) {
    console.error("Update manager error:", error)
    res.status(500).json({ error: "Failed to update manager details" })
  }
})

// Get all outlets with kiosk passwords (admin can view all outlets)
router.get('/outlets', async (req, res) => {
  try {
    const { regionId } = req.query

    const where: any = {}
    if (regionId) {
      where.regionId = regionId as string
    }

    const outlets = await prisma.outlet.findMany({
      where,
      include: {
        region: {
          select: {
            name: true
          }
        },
        _count: {
          select: {
            officers: true
          }
        }
      },
      orderBy: [
        { isActive: 'desc' },
        { name: 'asc' }
      ]
    })

    // Return outlets with kiosk password info
    const outletsWithPasswords = outlets.map(outlet => ({
      id: outlet.id,
      name: outlet.name,
      location: outlet.location,
      regionName: outlet.region.name,
      regionId: outlet.regionId,
      isActive: outlet.isActive,
      kioskPassword: outlet.kioskPassword, // Admin can see passwords
      counterCount: outlet.counterCount,
      officerCount: outlet._count.officers,
      createdAt: outlet.createdAt
    }))

    res.json(outletsWithPasswords)
  } catch (error) {
    console.error('Failed to fetch outlets', error)
    res.status(500).json({ error: 'Failed to fetch outlets' })
  }
})

// Reset kiosk password for an outlet
router.post('/outlets/:outletId/reset-kiosk-password', async (req, res) => {
  try {
    const { outletId } = req.params

    // Check if outlet exists
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: {
        id: true,
        name: true,
        location: true
      }
    })

    if (!outlet) {
      return res.status(404).json({ error: 'Outlet not found' })
    }

    // Generate new password
    const newPassword = generateSecurePassword()

    // Update outlet with new password
    await prisma.outlet.update({
      where: { id: outletId },
      data: { kioskPassword: newPassword }
    })

    res.json({
      success: true,
      message: `Kiosk password reset successfully for ${outlet.name}`,
      outletId: outlet.id,
      outletName: outlet.name,
      newPassword: newPassword
    })
  } catch (error) {
    console.error('Failed to reset kiosk password', error)
    res.status(500).json({ error: 'Failed to reset kiosk password' })
  }
})

// View kiosk password for an outlet
router.get('/outlets/:outletId/kiosk-password', async (req, res) => {
  try {
    const { outletId } = req.params

    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: {
        id: true,
        name: true,
        location: true,
        kioskPassword: true,
        region: {
          select: {
            name: true
          }
        }
      }
    })

    if (!outlet) {
      return res.status(404).json({ error: 'Outlet not found' })
    }

    res.json({
      outletId: outlet.id,
      outletName: outlet.name,
      location: outlet.location,
      regionName: outlet.region.name,
      kioskPassword: outlet.kioskPassword
    })
  } catch (error) {
    console.error('Failed to fetch kiosk password', error)
    res.status(500).json({ error: 'Failed to fetch kiosk password' })
  }
})

// Get feedback for Admin (all ratings with enhanced filters)
router.get("/feedback", async (req, res) => {
  try {
    const {
      page = "1",
      limit = "20",
      resolved = "",
      startDate,
      endDate,
      rating,
      regionId,
      outletId
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build base where clause for stats (no hardcoded rating)
    const baseWhere: any = {}

    // Build filtered where clause (includes user filters)
    const where: any = { ...baseWhere }

    // Rating filter
    if (rating && rating !== "") {
      const ratingNum = parseInt(rating as string)
      if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5) {
        where.rating = ratingNum
        baseWhere.rating = ratingNum
      }
    }

    // RTOM (region) filter — filter via token.outlet.regionId
    if (regionId && regionId !== "") {
      where.token = { ...where.token, outlet: { ...(where.token?.outlet || {}), regionId: regionId as string } }
    }

    // Teleshop (branch/outlet) filter — filter via token.outletId
    if (outletId && outletId !== "") {
      where.token = { ...where.token, outletId: outletId as string }
    }

    if (resolved === "true") {
      where.isResolved = true
    } else if (resolved === "false") {
      where.isResolved = false
    }

    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(startDate as string)
      if (endDate) where.createdAt.lte = new Date(endDate as string)
    }

    // Get feedback
    const [feedback, totalCount] = await Promise.all([
      prisma.feedback.findMany({
        where,
        include: {
          token: {
            include: {
              officer: {
                select: {
                  id: true,
                  name: true,
                  mobileNumber: true,
                  counterNumber: true
                }
              },
              outlet: {
                select: {
                  id: true,
                  name: true,
                  location: true,
                  region: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              }
            }
          },
          customer: {
            select: {
              id: true,
              name: true,
              mobileNumber: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limitNum
      }),
      prisma.feedback.count({ where })
    ])

    // Calculate statistics using baseWhere (unfiltered by user selections)
    const stats = {
      totalFeedback: await prisma.feedback.count({ where: baseWhere }),
      unresolvedFeedback: await prisma.feedback.count({
        where: {
          ...baseWhere,
          isResolved: false
        }
      }),
      resolvedFeedback: await prisma.feedback.count({
        where: {
          ...baseWhere,
          isResolved: true
        }
      }),
      todayFeedback: await prisma.feedback.count({
        where: {
          ...baseWhere,
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      })
    }

    res.json({
      feedback,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        hasNext: pageNum * limitNum < totalCount,
        hasPrev: pageNum > 1
      },
      stats
    })
  } catch (error) {
    console.error("Get admin feedback error:", error)
    res.status(500).json({ error: "Failed to get feedback" })
  }
})

// Resolve feedback (mark as resolved with resolution comment) for Admin
router.patch("/feedback/:feedbackId/resolve", async (req, res) => {
  try {
    const { feedbackId } = req.params
    const { resolutionComment } = req.body

    // Verify feedback exists
    const existingFeedback = await prisma.feedback.findFirst({
      where: {
        id: feedbackId
      },
      include: {
        token: {
          select: {
            outletId: true
          }
        }
      }
    })

    if (!existingFeedback) {
      return res.status(404).json({ error: "Feedback not found" })
    }

    if ((existingFeedback as any).isResolved) {
      return res.status(400).json({ error: "Feedback is already resolved" })
    }

    // Update feedback as resolved
    const updatedFeedback = await prisma.feedback.update({
      where: { id: feedbackId },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy: "Admin",
        resolutionComment: resolutionComment || "Resolved by admin"
      } as any,
      include: {
        token: {
          include: {
            officer: {
              select: {
                id: true,
                name: true,
                mobileNumber: true,
                counterNumber: true
              }
            },
            outlet: {
              select: {
                id: true,
                name: true,
                location: true
              }
            }
          }
        },
        customer: {
          select: {
            id: true,
            name: true,
            mobileNumber: true
          }
        }
      }
    })

    res.json({
      success: true,
      feedback: updatedFeedback,
      message: "Feedback resolved successfully"
    })
  } catch (error) {
    console.error("Resolve admin feedback error:", error)
    res.status(500).json({ error: "Failed to resolve feedback" })
  }
})

// Get system health status  
router.get("/system-health", async (req, res) => {
  try {
    // Helper: convert probe key to display data
    const buildEntry = (
      name: string,
      key: string,
    ) => {
      const healthy = healthTracker.isHealthy(key)
      const uptime = healthTracker.getUptime(key)
      const latest = healthTracker.getLatest(key)

      // If no probe data yet (server just started), show as initialising
      if (healthy === null) {
        return {
          name,
          status: "Checking",
          uptime: "—",
          icon: "AlertTriangle",
          statusColor: "bg-[#fef9c3] text-[#854d0e]",
          iconColor: "text-[#eab308]",
        }
      }

      // Determine status label based on uptime %
      const pct = parseFloat(uptime)
      let status: string
      let icon: string
      let statusColor: string
      let iconColor: string

      if (healthy && pct >= 99) {
        status = "Healthy"; icon = "CheckCircle"
        statusColor = "bg-[#dcfce7] text-[#166534]"; iconColor = "text-[#22c55e]"
      } else if (pct >= 90) {
        status = "Warning"; icon = "AlertTriangle"
        statusColor = "bg-[#fef9c3] text-[#854d0e]"; iconColor = "text-[#eab308]"
      } else {
        status = "Error"; icon = "XCircle"
        statusColor = "bg-[#fee2e2] text-[#991b1b]"; iconColor = "text-[#ef4444]"
      }

      return { name, status, uptime, icon, statusColor, iconColor }
    }

    const systemHealth = [
      buildEntry("Application Server", "app"),
      buildEntry("Database Connection", "db"),
      buildEntry("SMS Gateway", "sms"),
      buildEntry("Email Service", "email"),
    ]

    res.json(systemHealth)
  } catch (error) {
    console.error("System health check error:", error)
    res.status(500).json({ error: "Failed to fetch system health" })
  }
})

// --- Admin: Officers endpoints ---
// Get all officers with outlet info
router.get('/officers', async (req, res) => {
  try {
    const officers = await prisma.officer.findMany({ include: { outlet: true } })
    res.json(officers)
  } catch (error) {
    console.error('Failed to fetch officers', error)
    res.status(500).json({ error: 'Failed to fetch officers' })
  }
})

// Update officer (partial)
router.patch('/officer/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { counterNumber, assignedServices, status, name } = req.body

    const data: any = {}
    if (counterNumber !== undefined) {
      // validate officer exists and outlet counter capacity
      const officer = await prisma.officer.findUnique({ where: { id }, include: { outlet: true } })
      if (!officer) return res.status(404).json({ error: 'Officer not found' })

      const parsed = Number(counterNumber)
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'counterNumber must be a non-negative integer' })
      }

      const max = officer.outlet?.counterCount ?? 0
      if (parsed > max) {
        return res.status(400).json({ error: `Counter number ${parsed} exceeds available counters (${max}) for this outlet` })
      }

      data.counterNumber = parsed
    }
    if (assignedServices !== undefined) data.assignedServices = assignedServices
    if (status !== undefined) data.status = status
    if (name !== undefined) data.name = name

    const officer = await prisma.officer.update({ where: { id }, data })
    res.json({ success: true, officer })
  } catch (error) {
    console.error('Failed to update officer', error)
    res.status(500).json({ error: 'Failed to update officer' })
  }
})

// Delete region
router.delete('/regions/:regionId', async (req, res) => {
  try {
    const { regionId } = req.params

    // Check if region exists
    const region = await prisma.region.findUnique({
      where: { id: regionId },
      include: { outlets: true }
    })

    if (!region) {
      return res.status(404).json({ error: 'Region not found' })
    }

    // Check if region has outlets
    if (region.outlets.length > 0) {
      return res.status(400).json({
        error: `Cannot delete region "${region.name}" because it has ${region.outlets.length} outlet(s). Please delete or reassign the outlets first.`
      })
    }

    // Delete the region
    await prisma.region.delete({
      where: { id: regionId }
    })

    res.json({
      success: true,
      message: `Region "${region.name}" deleted successfully`
    })
  } catch (error) {
    console.error('Failed to delete region', error)
    res.status(500).json({ error: 'Failed to delete region' })
  }
})

// ========= GM MANAGEMENT =========

// ========= GM MANAGEMENT =========

// List all GMs
router.get("/gms", async (req, res) => {
  try {
    const gms = await (prisma as any).gM.findMany({ orderBy: { createdAt: "desc" } })
    res.json({ success: true, gms })
  } catch (err) {
    console.error("List GMs error:", err)
    res.status(500).json({ error: "Failed to fetch GMs" })
  }
})

// Create a GM (no region assignment - island-wide admin)
router.post("/gms", async (req, res) => {
  try {
    const { name, mobileNumber, email } = req.body
    if (!name || !mobileNumber) return res.status(400).json({ error: "name and mobileNumber are required" })
    if (!isValidName(name)) return res.status(400).json({ error: "Name must be between 2 and 100 characters" })
    if (!isValidSLMobile(mobileNumber)) return res.status(400).json({ error: "Invalid mobile number. Must be a valid Sri Lankan number (e.g. 0771234567)" })
    if (email && !isValidEmail(email)) return res.status(400).json({ error: "Invalid email address format" })
    const existing = await (prisma as any).gM.findFirst({ where: { mobileNumber } })
    if (existing) return res.status(400).json({ error: "A GM with this mobile number already exists" })
    const gm = await (prisma as any).gM.create({ data: { name, mobileNumber, email: email || null } })

    // Send notifications
    const loginUrl = "https://digital-queue-management-platform.vercel.app/gm/login"

    // Email
    if (email) {
      emailService.sendStaffWelcomeEmail({
        name,
        email,
        mobileNumber,
        role: "GM",
        loginUrl
      }).catch(err => console.error("GM welcome email failed:", err))
    }

    // SMS
    sltSmsService.sendStaffWelcomeSMS(mobileNumber, {
      name,
      role: "GM",
      loginUrl
    }).catch(err => console.error("GM welcome SMS failed:", err))

    res.json({ success: true, gm })
  } catch (err) {
    console.error("Create GM error:", err)
    res.status(500).json({ error: "Failed to create GM" })
  }
})

// Update a GM
router.put("/gms/:gmId", async (req, res) => {
  try {
    const { gmId } = req.params
    const { name, mobileNumber, email, isActive } = req.body
    const gm = await (prisma as any).gM.update({
      where: { id: gmId },
      data: { ...(name && { name }), ...(mobileNumber && { mobileNumber }), ...(email !== undefined && { email }), ...(isActive !== undefined && { isActive }) }
    })
    res.json({ success: true, gm })
  } catch (err: any) {
    if (err.code === "P2025") return res.status(404).json({ error: "GM not found" })
    console.error("Update GM error:", err)
    res.status(500).json({ error: "Failed to update GM" })
  }
})

// Delete a GM
router.delete("/gms/:gmId", async (req, res) => {
  try {
    const { gmId } = req.params
    await (prisma as any).gM.delete({ where: { id: gmId } })
    res.json({ success: true })
  } catch (err: any) {
    if (err.code === "P2025") return res.status(404).json({ error: "GM not found" })
    console.error("Delete GM error:", err)
    res.status(500).json({ error: "Failed to delete GM" })
  }
})

// ========= DGM MANAGEMENT =========

// List all DGMs (Admin view)
router.get("/dgms", async (req, res) => {
  try {
    const dgms = await (prisma as any).dGM.findMany({
      include: { gm: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" }
    })
    res.json({ success: true, dgms })
  } catch (err) {
    console.error("List DGMs error:", err)
    res.status(500).json({ error: "Failed to fetch DGMs" })
  }
})

// Create a DGM (Admin)
router.post("/dgms", async (req, res) => {
  try {
    const { name, mobileNumber, email, gmId, regionIds } = req.body
    if (!name || !mobileNumber || !gmId) return res.status(400).json({ error: "name, mobileNumber, and gmId are required" })
    if (!isValidName(name)) return res.status(400).json({ error: "Name must be between 2 and 100 characters" })
    if (!isValidSLMobile(mobileNumber)) return res.status(400).json({ error: "Invalid mobile number. Must be a valid Sri Lankan number (e.g. 0771234567)" })
    if (email && !isValidEmail(email)) return res.status(400).json({ error: "Invalid email address format" })
    const existing = await (prisma as any).dGM.findFirst({ where: { mobileNumber } })
    if (existing) return res.status(400).json({ error: "A DGM with this mobile number already exists" })
    const gm = await (prisma as any).gM.findUnique({ where: { id: gmId } })
    if (!gm) return res.status(404).json({ error: "GM not found" })

    // Region conflict check
    const ids = regionIds || []
    if (ids.length > 0) {
      const conflicting = await (prisma as any).dGM.findFirst({ where: { regionIds: { hasSome: ids } } })
      if (conflicting) {
        const takenRegions = await prisma.region.findMany({ where: { id: { in: ids.filter((id: string) => conflicting.regionIds.includes(id)) } }, select: { name: true } })
        const names = takenRegions.map((r: any) => r.name).join(", ")
        return res.status(400).json({ error: `Region(s) already assigned to another DGM: ${names}` })
      }
    }

    const dgm = await (prisma as any).dGM.create({ data: { name, mobileNumber, email: email || null, gmId, regionIds: ids } })

    // Send notifications
    const loginUrl = "https://digital-queue-management-platform.vercel.app/dgm/login"

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

    res.json({ success: true, dgm })
  } catch (err) {
    console.error("Create DGM error:", err)
    res.status(500).json({ error: "Failed to create DGM" })
  }
})

// Update a DGM (Admin)
router.put("/dgms/:dgmId", async (req, res) => {
  try {
    const { dgmId } = req.params
    const { name, mobileNumber, email, gmId, regionIds, isActive } = req.body

    // Region conflict check (exclude this DGM)
    if (regionIds !== undefined && regionIds.length > 0) {
      const conflicting = await (prisma as any).dGM.findFirst({ where: { regionIds: { hasSome: regionIds }, id: { not: dgmId } } })
      if (conflicting) {
        const takenIds = regionIds.filter((id: string) => conflicting.regionIds.includes(id))
        const takenRegions = await prisma.region.findMany({ where: { id: { in: takenIds } }, select: { name: true } })
        const names = takenRegions.map((r: any) => r.name).join(", ")
        return res.status(400).json({ error: `Region(s) already assigned to another DGM: ${names}` })
      }
    }

    const dgm = await (prisma as any).dGM.update({
      where: { id: dgmId },
      data: { ...(name && { name }), ...(mobileNumber && { mobileNumber }), ...(email !== undefined && { email }), ...(gmId && { gmId }), ...(regionIds !== undefined && { regionIds }), ...(isActive !== undefined && { isActive }) }
    })
    res.json({ success: true, dgm })
  } catch (err: any) {
    if (err.code === "P2025") return res.status(404).json({ error: "DGM not found" })
    console.error("Update DGM error:", err)
    res.status(500).json({ error: "Failed to update DGM" })
  }
})

// Delete a DGM
router.delete("/dgms/:dgmId", async (req, res) => {
  try {
    const { dgmId } = req.params
    await (prisma as any).dGM.delete({ where: { id: dgmId } })
    res.json({ success: true })
  } catch (err: any) {
    if (err.code === "P2025") return res.status(404).json({ error: "DGM not found" })
    console.error("Delete DGM error:", err)
    res.status(500).json({ error: "Failed to delete DGM" })
  }
})

// GET /admin/backup — export all tables as a JSON backup file (all fields, all rows)
router.get("/backup", async (req, res) => {
  try {
    const [
      regions,
      outlets,
      officers,
      customers,
      tokens,
      feedback,
      completedServices,
      services,
      appointments,
      breakLogs,
      transferLogs,
      serviceCases,
      serviceCaseUpdates,
      closureNotices,
      managerQRTokens,
      teleshopManagers,
      gms,
      dgms,
      otps,
      sltBills,
      mercantileHolidays,
      documents,
      alerts,
    ] = await Promise.all([
      prisma.region.findMany(),
      prisma.outlet.findMany(),
      prisma.officer.findMany(),
      prisma.customer.findMany(),
      prisma.token.findMany(),
      prisma.feedback.findMany(),
      prisma.completedService.findMany(),
      prisma.service.findMany(),
      prisma.appointment.findMany(),
      prisma.breakLog.findMany(),
      prisma.transferLog.findMany(),
      prisma.serviceCase.findMany(),
      prisma.serviceCaseUpdate.findMany(),
      prisma.closureNotice.findMany(),
      prisma.managerQRToken.findMany(),
      prisma.teleshopManager.findMany(),
      (prisma as any).gM.findMany(),
      (prisma as any).dGM.findMany(),
      (prisma as any).oTP.findMany(),
      (prisma as any).sltBill.findMany(),
      (prisma as any).mercantileHoliday.findMany(),
      prisma.document.findMany(),
      prisma.alert.findMany(),
    ])

    const backup = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      tables: {
        regions,
        outlets,
        officers,
        customers,
        tokens,
        feedback,
        completedServices,
        services,
        appointments,
        breakLogs,
        transferLogs,
        serviceCases,
        serviceCaseUpdates,
        closureNotices,
        managerQRTokens,
        teleshopManagers,
        gms,
        dgms,
        otps,
        sltBills,
        mercantileHolidays,
        documents,
        alerts,
      },
      counts: {
        regions: regions.length,
        outlets: outlets.length,
        officers: officers.length,
        customers: customers.length,
        tokens: tokens.length,
        feedback: feedback.length,
        completedServices: completedServices.length,
        services: services.length,
        appointments: appointments.length,
        breakLogs: breakLogs.length,
        transferLogs: transferLogs.length,
        serviceCases: serviceCases.length,
        serviceCaseUpdates: serviceCaseUpdates.length,
        closureNotices: closureNotices.length,
        managerQRTokens: managerQRTokens.length,
        teleshopManagers: teleshopManagers.length,
        gms: gms.length,
        dgms: dgms.length,
        otps: otps.length,
        sltBills: sltBills.length,
        mercantileHolidays: mercantileHolidays.length,
        documents: documents.length,
        alerts: alerts.length,
      },
    }

    const filename = `dqmp-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.send(JSON.stringify(backup, null, 2))
  } catch (error) {
    console.error("Backup error:", error)
    res.status(500).json({ error: "Failed to generate backup" })
  }
})

// POST /admin/restore — seed/restore all tables from a backup JSON file
router.post("/restore", authenticateAdmin, async (req: any, res) => {
  try {
    const { tables } = req.body
    if (!tables || typeof tables !== "object") {
      return res.status(400).json({ error: "Invalid backup format: missing 'tables'" })
    }

    const results: Record<string, number> = {}

    const ins = async (key: string, prismaCall: () => Promise<{ count: number }>) => {
      const rows = (tables as any)[key]
      if (!Array.isArray(rows) || rows.length === 0) return
      const r = await prismaCall()
      results[key] = r.count
    }

    // Level 0 — no FK dependencies
    await ins("regions",            () => prisma.region.createMany({ data: tables.regions, skipDuplicates: true }))
    await ins("services",           () => prisma.service.createMany({ data: tables.services, skipDuplicates: true }))
    await ins("gms",                () => (prisma as any).gM.createMany({ data: tables.gms, skipDuplicates: true }))
    await ins("customers",          () => prisma.customer.createMany({ data: tables.customers, skipDuplicates: true }))
    await ins("otps",               () => (prisma as any).oTP.createMany({ data: tables.otps, skipDuplicates: true }))
    await ins("sltBills",           () => (prisma as any).sltBill.createMany({ data: tables.sltBills, skipDuplicates: true }))
    await ins("mercantileHolidays", () => (prisma as any).mercantileHoliday.createMany({ data: tables.mercantileHolidays, skipDuplicates: true }))
    await ins("documents",          () => prisma.document.createMany({ data: tables.documents, skipDuplicates: true }))
    await ins("alerts",             () => prisma.alert.createMany({ data: tables.alerts, skipDuplicates: true }))

    // Level 1 — depends on regions
    await ins("outlets", () => prisma.outlet.createMany({ data: tables.outlets, skipDuplicates: true }))

    // Level 2 — depends on gms / outlets
    await ins("dgms",             () => (prisma as any).dGM.createMany({ data: tables.dgms, skipDuplicates: true }))
    await ins("officers",         () => prisma.officer.createMany({ data: tables.officers, skipDuplicates: true }))
    await ins("teleshopManagers", () => prisma.teleshopManager.createMany({ data: tables.teleshopManagers, skipDuplicates: true }))
    await ins("managerQRTokens",  () => prisma.managerQRToken.createMany({ data: tables.managerQRTokens, skipDuplicates: true }))
    await ins("closureNotices",   () => prisma.closureNotice.createMany({ data: tables.closureNotices, skipDuplicates: true }))
    await ins("appointments",     () => prisma.appointment.createMany({ data: tables.appointments, skipDuplicates: true }))

    // Level 3 — depends on customers + outlets + officers(nullable)
    await ins("tokens",    () => prisma.token.createMany({ data: tables.tokens, skipDuplicates: true }))
    await ins("breakLogs", () => prisma.breakLog.createMany({ data: tables.breakLogs, skipDuplicates: true }))

    // Level 4 — depends on tokens / officers / services
    await ins("feedback",          () => prisma.feedback.createMany({ data: tables.feedback, skipDuplicates: true }))
    await ins("completedServices", () => prisma.completedService.createMany({ data: tables.completedServices, skipDuplicates: true }))
    await ins("transferLogs",      () => prisma.transferLog.createMany({ data: tables.transferLogs, skipDuplicates: true }))
    await ins("serviceCases",      () => prisma.serviceCase.createMany({ data: tables.serviceCases, skipDuplicates: true }))

    // Level 5 — depends on serviceCases
    await ins("serviceCaseUpdates", () => prisma.serviceCaseUpdate.createMany({ data: tables.serviceCaseUpdates, skipDuplicates: true }))

    const totalRestored = Object.values(results).reduce((a, b) => a + b, 0)
    res.json({ success: true, restored: results, totalRestored })
  } catch (error: any) {
    console.error("Restore error:", error)
    res.status(500).json({ error: "Restore failed: " + (error?.message || "Unknown error") })
  }
})

// Test email service
router.post("/test/email", async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: "Email address is required" })
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" })
    }

    // Send test email
    const mailOptions = {
      from: {
        name: 'Digital Queue Management System',
        address: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@dqms.com'
      },
      to: email,
      subject: `DQMS Test Email - Service Verification`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2>DQMS Email Service Test</h2>
          <p>This is a test email from the Digital Queue Management System.</p>
          <p>If you received this email, the email service is working correctly.</p>
          <p>
            <strong>Test Date:</strong> ${new Date().toLocaleString()}<br>
            <strong>System:</strong> DQMS Admin Dashboard
          </p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #999;">
            This is an automated test message. Please ignore if you did not request this.
          </p>
        </div>
      `,
      text: `
DQMS Email Service Test

This is a test email from the Digital Queue Management System.
If you received this email, the email service is working correctly.

Test Date: ${new Date().toLocaleString()}
System: DQMS Admin Dashboard

---
This is an automated test message. Please ignore if you did not request this.
      `
    }

    const result = await emailService.sendTestEmail(email, mailOptions)
    
    if (result) {
      res.json({ success: true, message: `Test email sent to ${email}` })
    } else {
      res.status(500).json({ error: "Failed to send test email" })
    }
  } catch (error: any) {
    console.error("Test email error:", error)
    res.status(500).json({ error: "Test email failed: " + (error?.message || "Unknown error") })
  }
})

// Test SMS service
router.post("/test/sms", async (req, res) => {
  try {
    const { phoneNumber } = req.body

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" })
    }

    // Validate phone number format
    if (!isValidSLMobile(phoneNumber)) {
      return res.status(400).json({ error: "Invalid phone number format. Please use a valid Sri Lankan mobile number." })
    }

    // Send test SMS
    const testMessage = `DQMS Service Test: SMS service is working correctly. Time: ${new Date().toLocaleTimeString()}`
    
    const result = await sltSmsService.sendSMS({
      to: phoneNumber,
      message: testMessage
    })

    if (result.success) {
      res.json({ success: true, message: `Test SMS sent to ${phoneNumber}`, messageId: result.messageId })
    } else {
      res.status(500).json({ error: `Failed to send test SMS: ${result.error}` })
    }
  } catch (error: any) {
    console.error("Test SMS error:", error)
    res.status(500).json({ error: "Test SMS failed: " + (error?.message || "Unknown error") })
  }
})

export default router

