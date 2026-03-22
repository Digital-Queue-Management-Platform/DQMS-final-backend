import { Router } from "express"
import * as jwt from "jsonwebtoken"
import * as bcrypt from "bcrypt"
import { randomUUID } from "crypto"
import { prisma } from "../server"
import emailService from "../services/emailService"
import sltSmsService from "../services/sltSmsService"
import { generateSecurePassword } from "../utils/passwordGenerator"
import { getFrontendBaseUrl } from "../utils/urlHelper"
import { isValidSLMobile, isValidEmail, isValidName } from "../utils/validators"
import { healthTracker } from "../services/healthTracker"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
// No expiration for production system - admin needs continuous access
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined
const ADMIN_EMAIL = "admindqms@slt.lk"
const ADMIN_PASSWORD = "dqms2026@"
const STAFF_PRESENCE_WINDOW_MINUTES = Math.max(1, Number(process.env.ADMIN_STAFF_PRESENCE_MINUTES || 30))

// Interface for manager credentials
interface ManagerCredentials {
  email: string
  temporaryPassword: string
  message: string
  emailSent?: boolean
}

type StaffPresenceStatus = 'online' | 'break' | 'offline'

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

const getPresenceMeta = ({
  rawStatus,
  lastLoginAt,
  breakStartedAt,
  isActive = true,
}: {
  rawStatus?: string | null
  lastLoginAt?: Date | null
  breakStartedAt?: Date | null
  isActive?: boolean
}): { status: StaffPresenceStatus; label: string; source: 'tracked' | 'derived' } => {
  if (breakStartedAt || rawStatus === 'on_break' || rawStatus === 'break') {
    return { status: 'break', label: 'At Break', source: 'tracked' }
  }

  if (rawStatus === 'available' || rawStatus === 'serving' || rawStatus === 'busy') {
    return { status: 'online', label: 'Online', source: 'tracked' }
  }

  if (rawStatus === 'offline') {
    return { status: 'offline', label: 'Offline', source: 'tracked' }
  }

  if (!isActive) {
    return { status: 'offline', label: 'Inactive', source: 'derived' }
  }

  const isRecentlyActive = !!lastLoginAt && (Date.now() - new Date(lastLoginAt).getTime()) <= STAFF_PRESENCE_WINDOW_MINUTES * 60 * 1000
  return isRecentlyActive
    ? { status: 'online', label: 'Online', source: 'derived' }
    : { status: 'offline', label: 'Offline', source: 'derived' }
}

const isMissingManagerLastLoginFieldError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('managerLastLoginAt') || message.includes('Unknown field') || message.includes('P2022')
}

const fetchRegionsForStaffStatus = async () => {
  try {
    return await prisma.region.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        managerId: true,
        managerEmail: true,
        managerMobile: true,
        managerLastLoginAt: true,
      }
    })
  } catch (error) {
    if (!isMissingManagerLastLoginFieldError(error)) throw error

    const fallbackRegions = await prisma.region.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        managerId: true,
        managerEmail: true,
        managerMobile: true,
      }
    })

    return fallbackRegions.map(region => ({
      ...region,
      managerLastLoginAt: null as Date | null,
    }))
  }
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

// Admin login endpoint (Phase 1: Credentials check + OTP send)
router.post("/login", async (req, res) => {
  try {
    const { email, password, mobileNumber } = req.body

    // Validate email/password
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid email or password" })
    }

    // Validate mobile number format
    if (!mobileNumber || !isValidSLMobile(mobileNumber)) {
      return res.status(400).json({ error: "Valid Sri Lankan mobile number is required (e.g. 0771234567)" })
    }

    // Generate and send OTP to the provided mobile number
    const otpResult = await (require("../services/otpService").default).generateOTP(
      mobileNumber, 
      'admin', 
      'Super Admin'
    )

    if (!otpResult.success) {
      return res.status(500).json({ error: "Failed to send security code: " + otpResult.message })
    }

    res.json({
      success: true,
      needsOtp: true,
      message: "Security code sent to your mobile for further verification"
    })
  } catch (error) {
    console.error("Admin login initiation error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Admin login OTP verification (Phase 2)
router.post("/verify-login-otp", async (req, res) => {
  try {
    const { email, password, mobileNumber, otpCode } = req.body

    // Final security check
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Session expired or invalid credentials" })
    }

    if (!mobileNumber || !otpCode) {
      return res.status(400).json({ error: "Mobile number and security code are required" })
    }

    // Verify OTP for the specific number entered
    const verifyResult = await (require("../services/otpService").default).verifyOTP(
      mobileNumber, 
      otpCode, 
      'admin'
    )

    if (!verifyResult.success) {
      return res.status(401).json({ error: verifyResult.message || "Invalid security code" })
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
        name: "Super Admin",
        role: "admin"
      }
    })
  } catch (error) {
    console.error("Admin OTP verification error:", error)
    res.status(500).json({ error: "Verification failed" })
  }
})

// Apply authentication middleware to all other admin routes
router.use(authenticateAdmin)

const logBackupRestoreHistory = async ({
  req,
  action,
  status,
  filename,
  totalRecords,
  tableCounts,
  errorMessage,
}: {
  req: any
  action: 'backup' | 'restore'
  status: 'success' | 'failed'
  filename?: string
  totalRecords?: number
  tableCounts?: Record<string, number>
  errorMessage?: string
}) => {
  try {
    const historyDelegate = getBackupRestoreHistoryDelegate()

    if (historyDelegate && typeof historyDelegate.create === 'function') {
      await historyDelegate.create({
        data: {
          action,
          status,
          filename,
          totalRecords: totalRecords ?? 0,
          tableCounts: tableCounts as any,
          errorMessage,
          createdByRole: req?.user?.role || null,
          createdById: req?.user?.email || req?.user?.id || null,
        },
      })
      return
    }

    const rawTableCounts = tableCounts ? JSON.stringify(tableCounts) : null
    await prisma.$executeRaw`
      INSERT INTO "BackupRestoreHistory"
      ("id", "action", "status", "filename", "totalRecords", "tableCounts", "errorMessage", "createdByRole", "createdById", "createdAt")
      VALUES
      (
        ${randomUUID()},
        ${action},
        ${status},
        ${filename ?? null},
        ${totalRecords ?? 0},
        CAST(${rawTableCounts} AS jsonb),
        ${errorMessage ?? null},
        ${req?.user?.role || null},
        ${req?.user?.email || req?.user?.id || null},
        NOW()
      )
    `
  } catch (error) {
    console.error('Backup/restore history log error:', error)
  }
}

const isHistoryTableMissingError = (error: unknown) => {
  const prismaCode = (error as any)?.code
  const message = error instanceof Error ? error.message : String(error || '')

  return (
    prismaCode === 'P2021' ||
    prismaCode === 'P2022' ||
    message.includes('BackupRestoreHistory') ||
    message.includes('does not exist')
  )
}

const getBackupRestoreHistoryDelegate = () => {
  const delegate = (prisma as any)?.backupRestoreHistory
  return delegate && typeof delegate.findMany === 'function' ? delegate : null
}

const getBackupRestoreHistoryRaw = async ({
  action,
  take,
}: {
  action?: 'backup' | 'restore'
  take: number
}) => {
  const query = `
    SELECT
      "id",
      "action",
      "status",
      "filename",
      "totalRecords",
      "tableCounts",
      "errorMessage",
      "createdByRole",
      "createdById",
      "createdAt"
    FROM "BackupRestoreHistory"
    ${action ? 'WHERE "action" = $1' : ''}
    ORDER BY "createdAt" DESC
    LIMIT ${action ? '$2' : '$1'}
  `

  if (action) {
    return prisma.$queryRawUnsafe(query, action, take)
  }

  return prisma.$queryRawUnsafe(query, take)
}

// Get dashboard analytics
router.get("/analytics", async (req, res) => {
  try {
    const { startDate, endDate, outletId } = req.query
    const sDate = startDate ? new Date(startDate as string) : new Date()
    const eDate = endDate ? new Date(endDate as string) : new Date()

    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format provided" })
    }

    // Base query for all tokens in the date range (issued)
    const baseWhere: any = {
      createdAt: {
        gte: sDate,
        lte: eDate,
      }
    }
    if (outletId) baseWhere.outletId = outletId as string

    // Fetch all tokens for the range once
    const allTokens = await prisma.token.findMany({
      where: baseWhere,
      select: {
        id: true,
        tokenNumber: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        outletId: true,
        serviceTypes: true,
        assignedTo: true
      }
    })

    const totalIssued = allTokens.length
    const completedTokens = allTokens.filter(t => t.status === "completed" && t.completedAt && t.startedAt)
    const totalCompleted = completedTokens.length

    // Run other aggregated queries
    const [feedbackStats, officerRecords, allServices] = await Promise.all([
      prisma.feedback.findMany({
        where: { token: { ...baseWhere, status: "completed" } },
        select: { rating: true, createdAt: true, tokenId: true }
      }),
      prisma.officer.findMany({ 
        where: outletId ? { outletId: outletId as string } : {}, 
        include: { outlet: true } 
      }),
      prisma.service.findMany({ select: { code: true, title: true } })
    ])

    const avgWaitTime = totalCompleted > 0
      ? completedTokens.reduce((sum, token) => {
          const wait = (token.startedAt!.getTime() - token.createdAt.getTime()) / 1000 / 60
          return sum + wait
        }, 0) / totalCompleted
      : 0

    const avgServiceTime = totalCompleted > 0
      ? completedTokens.reduce((sum, token) => {
          const service = (token.completedAt!.getTime() - token.startedAt!.getTime()) / 1000 / 60
          return sum + service
        }, 0) / totalCompleted
      : 0

    // Optimized hourly aggregation using single-pass bucketing
    const hourlyBuckets = new Array(24).fill(null).map(() => ({
      issued: 0,
      completed: 0,
      waitSum: 0,
      waitCount: 0,
      serviceSum: 0,
      serviceCount: 0,
      ratingSum: 0,
      ratingCount: 0,
      activeOfficers: new Set<string>()
    }))

    allTokens.forEach(t => {
      const createdHour = t.createdAt.getHours()
      if (createdHour >= 8 && createdHour <= 18) {
        hourlyBuckets[createdHour].issued++
        if (t.assignedTo) hourlyBuckets[createdHour].activeOfficers.add(t.assignedTo)
      }

      if (t.status === "completed" && t.completedAt && t.startedAt) {
        const completedHour = t.completedAt.getHours()
        const startedHour = t.startedAt.getHours()
        
        if (completedHour >= 8 && completedHour <= 18) {
          hourlyBuckets[completedHour].completed++
          hourlyBuckets[completedHour].serviceSum += (t.completedAt.getTime() - t.startedAt.getTime()) / 1000 / 60
          hourlyBuckets[completedHour].serviceCount++
        }
        
        if (startedHour >= 8 && startedHour <= 18) {
          hourlyBuckets[startedHour].waitSum += (t.startedAt.getTime() - t.createdAt.getTime()) / 1000 / 60
          hourlyBuckets[startedHour].waitCount++
          if (t.assignedTo) hourlyBuckets[startedHour].activeOfficers.add(t.assignedTo)
        }
      } else if (t.status === 'serving' && t.startedAt) {
        const startedHour = t.startedAt.getHours()
        if (startedHour >= 8 && startedHour <= 18 && t.assignedTo) {
          hourlyBuckets[startedHour].activeOfficers.add(t.assignedTo)
        }
      }
    })

    // Aggregate feedbacks hourly
    const feedbacksRaw = feedbackStats as any[]
    feedbacksRaw.forEach(f => {
      const hour = f.createdAt.getHours()
      if (hour >= 8 && hour <= 18) {
        hourlyBuckets[hour].ratingSum += f.rating
        hourlyBuckets[hour].ratingCount++
      }
    })

    const hourlyStats = []
    const serviceTitleMap = new Map(allServices.map(s => [s.code, s.title]))
    const serviceTypeMap = new Map<string, number>()

    for (let hour = 8; hour <= 18; hour++) {
      const bucket = hourlyBuckets[hour]
      const avgWaitHour = bucket.waitCount > 0 ? bucket.waitSum / bucket.waitCount : 0
      const avgServiceHour = bucket.serviceCount > 0 ? bucket.serviceSum / bucket.serviceCount : 0
      const avgRatingHour = bucket.ratingCount > 0 ? bucket.ratingSum / bucket.ratingCount : 0
      
      hourlyStats.push({
        hour: `${hour.toString().padStart(2, '0')}:00`,
        waitTime: Math.round(avgWaitHour * 10) / 10,
        serviceTime: Math.round(avgServiceHour * 10) / 10,
        rating: Math.round(avgRatingHour * 10) / 10,
        feedbackCount: bucket.ratingCount,
        issued: bucket.issued,
        completed: bucket.completed,
        activeCounters: bucket.activeOfficers.size
      })
    }

    // Service Types aggregation
    allTokens.forEach(token => {
      const types = Array.isArray(token.serviceTypes) ? token.serviceTypes : []
      types.forEach(st => {
        const title = serviceTitleMap.get(st) || st
        serviceTypeMap.set(title, (serviceTypeMap.get(title) || 0) + 1)
      })
    })

    const serviceTypesFormatted = Array.from(serviceTypeMap.entries()).map(([name, count]) => ({
      name,
      count
    }))

    // Compatibility with existing rating distribution format
    const ratingDistribution = [1, 2, 3, 4, 5].map(r => ({
      rating: r,
      count: feedbacksRaw.filter(f => f.rating === r).length
    }))

    // Officer Performance
    const officerMap = new Map(officerRecords.map(o => [o.id, o]))
    const officerPerformanceMap = new Map<string, { count: number; ratings: number[] }>()
    
    allTokens.forEach(t => {
      if (t.status === "completed" && t.assignedTo) {
        if (!officerPerformanceMap.has(t.assignedTo)) {
          officerPerformanceMap.set(t.assignedTo, { count: 0, ratings: [] })
        }
        officerPerformanceMap.get(t.assignedTo)!.count++
      }
    })

    feedbacksRaw.forEach(f => {
      const token = allTokens.find(t => t.id === f.tokenId)
      if (token && token.assignedTo && officerPerformanceMap.has(token.assignedTo)) {
        officerPerformanceMap.get(token.assignedTo)!.ratings.push(f.rating)
      }
    })

    const officerPerformance = Array.from(officerPerformanceMap.entries()).map(([id, stats]) => ({
      officer: officerMap.get(id) || { id, name: "Unknown Officer", status: "offline" },
      tokensHandled: stats.count,
      avgRating: stats.ratings.length > 0 ? stats.ratings.reduce((a, b) => a + b, 0) / stats.ratings.length : 0,
      feedbackCount: stats.ratings.length
    }))

    res.json({
      totalTokens: totalIssued,
      totalCompleted,
      avgWaitTime: Math.round(avgWaitTime * 10) / 10,
      avgServiceTime: Math.round(avgServiceTime * 10) / 10,
      feedbackStats: ratingDistribution,
      serviceTypes: serviceTypesFormatted,
      officerPerformance,
      hourlyWaitingTimes: hourlyStats.map(h => ({ hour: h.hour, value: h.waitTime })),
      staffUtilizationTrend: hourlyStats.map(h => ({ 
        time: h.hour, 
        activeCounters: h.activeCounters, 
        customerDemand: h.issued 
      })),
      tokenFlow: hourlyStats.map(h => ({ 
        time: h.hour, 
        issued: h.issued, 
        completed: h.completed 
      })),
      hourlyStats
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

    if (importantOnly === "true") {
      where.severity = { in: ["high", "critical"] }
    } else if (severity) {
      where.severity = severity as string
    }

    // Direct outletId filter (for new alerts)
    if (outletId) {
      // Show alerts tagged with this outletId
      where.outletId = outletId as string
    }

    let alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200, // Increased from 50
    })

    // Fallback for old alerts if outletId is provided but we didn't find many
    if (outletId && alerts.length < 5) {
      // Find latest 1000 tokens for this branch to try matching older alerts
      const tokens = await prisma.token.findMany({
        where: { outletId: outletId as string },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { id: true }
      })
      const tokenIds = tokens.map(t => t.id)
      
      const oldAlerts = await prisma.alert.findMany({
        where: {
          ...where,
          outletId: null, // Only look at old alerts without outletId
          relatedEntity: { in: tokenIds }
        },
        orderBy: { createdAt: "desc" },
        take: 50
      })
      
      // Merge and sort
      alerts = [...alerts, ...oldAlerts].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ).slice(0, 200)
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
      const loginUrl = `${getFrontendBaseUrl()}/manager/login`

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

    // Outlets must be moved to another region before deleting this region (regionId is non-nullable)
    const outletCount = await prisma.outlet.count({ where: { regionId: id } })
    if (outletCount > 0) {
      return res.status(400).json({ error: `Cannot delete region with ${outletCount} active outlets. Please move them first.` })
    }

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
router.get('/staff-status', async (req, res) => {
  try {
    const [regions, outlets, officers, teleshopManagers, gms, dgms] = await Promise.all([
      fetchRegionsForStaffStatus(),
      prisma.outlet.findMany({
        orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          location: true,
          regionId: true,
          region: { select: { id: true, name: true } },
        }
      }),
      prisma.officer.findMany({
        orderBy: [{ outlet: { region: { name: 'asc' } } }, { outlet: { name: 'asc' } }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          mobileNumber: true,
          email: true,
          status: true,
          counterNumber: true,
          isTraining: true,
          createdAt: true,
          lastLoginAt: true,
          assignedServices: true,
          languages: true,
          outlet: {
            select: {
              id: true,
              name: true,
              location: true,
              regionId: true,
              region: { select: { id: true, name: true } },
            }
          },
          BreakLog: {
            where: { endedAt: null },
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: { startedAt: true }
          }
        }
      }),
      prisma.teleshopManager.findMany({
        orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          mobileNumber: true,
          email: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          regionId: true,
          region: { select: { id: true, name: true } },
          branchId: true,
          branch: { select: { id: true, name: true, location: true } },
        }
      }),
      (prisma as any).gM.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          mobileNumber: true,
          email: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
        }
      }),
      (prisma as any).dGM.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          mobileNumber: true,
          email: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          gmId: true,
          regionIds: true,
        }
      }),
    ])

    const regionMap = new Map(regions.map(region => [region.id, region]))
    const outletsByRegion = new Map<string, Array<(typeof outlets)[number]>>()
    for (const outlet of outlets) {
      if (!outletsByRegion.has(outlet.regionId)) outletsByRegion.set(outlet.regionId, [])
      outletsByRegion.get(outlet.regionId)!.push(outlet)
    }

    const roleOrder: Record<string, number> = {
      gm: 1,
      dgm: 2,
      manager: 3,
      teleshop_manager: 4,
      officer: 5,
    }

    const staff = [
      ...officers.map((officer) => {
        const activeBreak = officer.BreakLog[0]?.startedAt || null
        const presence = getPresenceMeta({
          rawStatus: officer.status,
          lastLoginAt: officer.lastLoginAt,
          breakStartedAt: activeBreak,
        })
        const assignedServices = Array.isArray(officer.assignedServices) ? officer.assignedServices.length : 0
        const languages = toStringArray(officer.languages)

        return {
          id: officer.id,
          name: officer.name,
          mobileNumber: officer.mobileNumber,
          email: officer.email,
          roleKey: 'officer',
          roleLabel: 'Customer Service Officer',
          status: presence.status,
          statusLabel: presence.label,
          statusSource: presence.source,
          rawStatus: officer.status,
          accountState: 'active',
          accountStateLabel: 'Active',
          lastLoginAt: officer.lastLoginAt,
          createdAt: officer.createdAt,
          regionId: officer.outlet.regionId,
          regionName: officer.outlet.region.name,
          outletId: officer.outlet.id,
          outletName: officer.outlet.name,
          outletLocation: officer.outlet.location,
          primaryRegionId: officer.outlet.regionId,
          primaryRegionName: officer.outlet.region.name,
          coverageRegionIds: [officer.outlet.regionId],
          coverageOutletIds: [officer.outlet.id],
          scopeLabel: officer.counterNumber ? `Counter ${officer.counterNumber}` : 'Outlet coverage',
          counterNumber: officer.counterNumber,
          breakStartedAt: activeBreak,
          breakDurationMinutes: activeBreak ? Math.max(0, Math.floor((Date.now() - new Date(activeBreak).getTime()) / 60000)) : 0,
          languages,
          assignedServicesCount: assignedServices,
          isTraining: officer.isTraining,
          isActive: true,
          roleOrder: roleOrder.officer,
        }
      }),
      ...teleshopManagers.map((manager) => {
        const presence = getPresenceMeta({
          lastLoginAt: manager.lastLoginAt,
          isActive: manager.isActive,
        })

        return {
          id: manager.id,
          name: manager.name,
          mobileNumber: manager.mobileNumber,
          email: manager.email,
          roleKey: 'teleshop_manager',
          roleLabel: 'Teleshop Manager',
          status: presence.status,
          statusLabel: presence.label,
          statusSource: presence.source,
          rawStatus: null,
          accountState: manager.isActive ? 'active' : 'inactive',
          accountStateLabel: manager.isActive ? 'Active' : 'Inactive',
          lastLoginAt: manager.lastLoginAt,
          createdAt: manager.createdAt,
          regionId: manager.regionId,
          regionName: manager.region.name,
          outletId: manager.branch?.id || null,
          outletName: manager.branch?.name || null,
          outletLocation: manager.branch?.location || null,
          primaryRegionId: manager.regionId,
          primaryRegionName: manager.region.name,
          coverageRegionIds: [manager.regionId],
          coverageOutletIds: manager.branchId ? [manager.branchId] : (outletsByRegion.get(manager.regionId) || []).map(outlet => outlet.id),
          scopeLabel: manager.branch?.name ? 'Branch oversight' : 'Regional support',
          counterNumber: null,
          breakStartedAt: null,
          breakDurationMinutes: 0,
          languages: [],
          assignedServicesCount: 0,
          isTraining: false,
          isActive: manager.isActive,
          roleOrder: roleOrder.teleshop_manager,
        }
      }),
      ...regions
        .filter(region => !!region.managerId || !!region.managerMobile || !!region.managerEmail)
        .map((region) => {
          const presence = getPresenceMeta({ lastLoginAt: region.managerLastLoginAt })
          const coveredOutlets = (outletsByRegion.get(region.id) || []).map(outlet => outlet.id)

          return {
            id: `manager:${region.id}`,
            name: region.managerId || region.name,
            mobileNumber: region.managerMobile || null,
            email: region.managerEmail || null,
            roleKey: 'manager',
            roleLabel: 'RTOM',
            status: presence.status,
            statusLabel: presence.label,
            statusSource: presence.source,
            rawStatus: null,
            accountState: 'active',
            accountStateLabel: 'Configured',
            lastLoginAt: region.managerLastLoginAt,
            createdAt: null,
            regionId: region.id,
            regionName: region.name,
            outletId: null,
            outletName: null,
            outletLocation: null,
            primaryRegionId: region.id,
            primaryRegionName: region.name,
            coverageRegionIds: [region.id],
            coverageOutletIds: coveredOutlets,
            scopeLabel: `${coveredOutlets.length} outlet${coveredOutlets.length === 1 ? '' : 's'} in region`,
            counterNumber: null,
            breakStartedAt: null,
            breakDurationMinutes: 0,
            languages: [],
            assignedServicesCount: 0,
            isTraining: false,
            isActive: true,
            roleOrder: roleOrder.manager,
          }
        }),
      ...dgms.map((dgm: any) => {
        const presence = getPresenceMeta({
          lastLoginAt: dgm.lastLoginAt,
          isActive: dgm.isActive,
        })
        const coverageRegionIds = toStringArray(dgm.regionIds)
        const coverageOutletIds = coverageRegionIds.flatMap((regionId) => (outletsByRegion.get(regionId) || []).map(outlet => outlet.id))
        const primaryRegion = regionMap.get(coverageRegionIds[0] || '')

        return {
          id: dgm.id,
          name: dgm.name,
          mobileNumber: dgm.mobileNumber,
          email: dgm.email,
          roleKey: 'dgm',
          roleLabel: 'DGM',
          status: presence.status,
          statusLabel: presence.label,
          statusSource: presence.source,
          rawStatus: null,
          accountState: dgm.isActive ? 'active' : 'inactive',
          accountStateLabel: dgm.isActive ? 'Active' : 'Inactive',
          lastLoginAt: dgm.lastLoginAt,
          createdAt: dgm.createdAt,
          regionId: null,
          regionName: null,
          outletId: null,
          outletName: null,
          outletLocation: null,
          primaryRegionId: primaryRegion?.id || '__multi_region__',
          primaryRegionName: primaryRegion?.name || 'Multi-region Coverage',
          coverageRegionIds,
          coverageOutletIds,
          scopeLabel: `${coverageRegionIds.length} region${coverageRegionIds.length === 1 ? '' : 's'} assigned`,
          counterNumber: null,
          breakStartedAt: null,
          breakDurationMinutes: 0,
          languages: [],
          assignedServicesCount: 0,
          isTraining: false,
          isActive: dgm.isActive,
          roleOrder: roleOrder.dgm,
        }
      }),
      ...gms.map((gm: any) => {
        const presence = getPresenceMeta({
          lastLoginAt: gm.lastLoginAt,
          isActive: gm.isActive,
        })

        return {
          id: gm.id,
          name: gm.name,
          mobileNumber: gm.mobileNumber,
          email: gm.email,
          roleKey: 'gm',
          roleLabel: 'GM',
          status: presence.status,
          statusLabel: presence.label,
          statusSource: presence.source,
          rawStatus: null,
          accountState: gm.isActive ? 'active' : 'inactive',
          accountStateLabel: gm.isActive ? 'Active' : 'Inactive',
          lastLoginAt: gm.lastLoginAt,
          createdAt: gm.createdAt,
          regionId: null,
          regionName: null,
          outletId: null,
          outletName: null,
          outletLocation: null,
          primaryRegionId: '__islandwide__',
          primaryRegionName: 'Island-wide Coverage',
          coverageRegionIds: regions.map(region => region.id),
          coverageOutletIds: outlets.map(outlet => outlet.id),
          scopeLabel: 'All regions',
          counterNumber: null,
          breakStartedAt: null,
          breakDurationMinutes: 0,
          languages: [],
          assignedServicesCount: 0,
          isTraining: false,
          isActive: gm.isActive,
          roleOrder: roleOrder.gm,
        }
      }),
    ].sort((left, right) => {
      const regionCompare = (left.primaryRegionName || '').localeCompare(right.primaryRegionName || '')
      if (regionCompare !== 0) return regionCompare
      if (left.roleOrder !== right.roleOrder) return left.roleOrder - right.roleOrder
      return left.name.localeCompare(right.name)
    })

    const summary = staff.reduce((acc, member) => {
      acc.total += 1
      if (member.status === 'online') acc.online += 1
      if (member.status === 'break') acc.onBreak += 1
      if (member.status === 'offline') acc.offline += 1
      acc.byRole[member.roleKey] = (acc.byRole[member.roleKey] || 0) + 1
      return acc
    }, {
      total: 0,
      online: 0,
      onBreak: 0,
      offline: 0,
      byRole: {} as Record<string, number>,
    })

    res.json({
      staff,
      summary,
      filters: {
        regions: regions.map(region => ({ id: region.id, name: region.name })),
        outlets: outlets.map(outlet => ({
          id: outlet.id,
          name: outlet.name,
          location: outlet.location,
          regionId: outlet.regionId,
          regionName: outlet.region.name,
        })),
        roles: [
          { id: 'gm', label: 'GM' },
          { id: 'dgm', label: 'DGM' },
          { id: 'manager', label: 'RTOM' },
          { id: 'teleshop_manager', label: 'Teleshop Manager' },
          { id: 'officer', label: 'Customer Service Officer' },
        ],
      },
      presenceWindowMinutes: STAFF_PRESENCE_WINDOW_MINUTES,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Failed to fetch staff status', error)
    res.status(500).json({ error: 'Failed to fetch staff status' })
  }
})

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
    const { counterNumber, assignedServices, status, name, email } = req.body

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
    if (email !== undefined) data.email = email || null

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
    const loginUrl = `${getFrontendBaseUrl()}/gm/login`

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
    const loginUrl = `${getFrontendBaseUrl()}/dgm/login`

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
    const totalRecords = Object.values(backup.counts).reduce((sum, value) => sum + value, 0)

    await logBackupRestoreHistory({
      req,
      action: 'backup',
      status: 'success',
      filename,
      totalRecords,
      tableCounts: backup.counts,
    })

    res.setHeader("Content-Type", "application/json")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.send(JSON.stringify(backup, null, 2))
  } catch (error) {
    console.error("Backup error:", error)
    await logBackupRestoreHistory({
      req,
      action: 'backup',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    res.status(500).json({ error: "Failed to generate backup" })
  }
})

// GET /admin/backup-history — get persistent backup and restore history
router.get("/backup-history", async (req, res) => {
  try {
    const historyDelegate = getBackupRestoreHistoryDelegate()
    if (!historyDelegate) {
      // Prisma client can be stale if `prisma generate` has not run in this environment.
      return res.json({ history: [], warning: 'History model is not available in the running backend yet.' })
    }

    const actionRaw = typeof req.query.action === 'string' ? req.query.action : undefined
    const action = actionRaw === 'backup' || actionRaw === 'restore' ? actionRaw : undefined
    const parsedLimit = Number(req.query.limit)
    const take = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(200, parsedLimit)) : 100

    const history = historyDelegate
      ? await historyDelegate.findMany({
        where: action ? { action } : undefined,
        orderBy: { createdAt: 'desc' },
        take,
      })
      : await getBackupRestoreHistoryRaw({ action, take })

    res.json({ history })
  } catch (error) {
    if (isHistoryTableMissingError(error)) {
      // Keep admin UI functional even when one environment has not run the latest migration yet.
      return res.json({ history: [], warning: 'History table is not available in this database yet.' })
    }

    console.error('Backup history fetch error:', error)
    res.status(500).json({ error: 'Failed to fetch backup history' })
  }
})

// POST /admin/restore — seed/restore all tables from a backup JSON file
router.post("/restore", authenticateAdmin, async (req: any, res) => {
  const sourceFilename = typeof req.body?._meta?.filename === 'string' ? req.body._meta.filename : undefined
  try {
    const { tables } = req.body
    if (!tables || typeof tables !== "object") {
      return res.status(400).json({ error: "Invalid backup format: missing 'tables'" })
    }

    const results: Record<string, number> = {}

    const ins = async (key: string, prismaCall: (safeRows: any[]) => Promise<{ count: number }>) => {
      const rows = (tables as any)[key]
      if (!Array.isArray(rows) || rows.length === 0) return

      let safeRows = rows
      for (let i = 0; i < 10; i++) {
        try {
          const r = await prismaCall(safeRows)
          results[key] = r.count
          return
        } catch (error: any) {
          // Be tolerant when restoring backups from a slightly different schema.
          if (error?.code !== 'P2022') throw error
          const missingColumnRaw = error?.meta?.column as string | undefined
          if (!missingColumnRaw) throw error

          const missingColumn = missingColumnRaw.replace(/"/g, '')
          safeRows = safeRows.map((row: any) => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) return row
            const copy = { ...row }
            delete copy[missingColumn]
            return copy
          })
        }
      }

      throw new Error(`Could not restore table '${key}' after removing missing columns`)
    }

    // Level 0 — no FK dependencies
    await ins("regions",            (safeRows) => prisma.region.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("services",           (safeRows) => prisma.service.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("gms",                (safeRows) => (prisma as any).gM.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("customers",          (safeRows) => prisma.customer.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("otps",               (safeRows) => (prisma as any).oTP.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("sltBills",           (safeRows) => (prisma as any).sltBill.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("mercantileHolidays", (safeRows) => (prisma as any).mercantileHoliday.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("documents",          (safeRows) => prisma.document.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("alerts",             (safeRows) => prisma.alert.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 1 — depends on regions
    await ins("outlets", (safeRows) => prisma.outlet.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 2 — depends on gms / outlets
    await ins("dgms",             (safeRows) => (prisma as any).dGM.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("officers",         (safeRows) => prisma.officer.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("teleshopManagers", (safeRows) => prisma.teleshopManager.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("managerQRTokens",  (safeRows) => prisma.managerQRToken.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("closureNotices",   (safeRows) => prisma.closureNotice.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("appointments",     (safeRows) => prisma.appointment.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 3 — depends on customers + outlets + officers(nullable)
    await ins("tokens",    (safeRows) => prisma.token.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("breakLogs", (safeRows) => prisma.breakLog.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 4 — depends on tokens / officers / services
    await ins("feedback",          (safeRows) => prisma.feedback.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("completedServices", (safeRows) => prisma.completedService.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("transferLogs",      (safeRows) => prisma.transferLog.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("serviceCases",      (safeRows) => prisma.serviceCase.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 5 — depends on serviceCases
    await ins("serviceCaseUpdates", (safeRows) => prisma.serviceCaseUpdate.createMany({ data: safeRows, skipDuplicates: true }))

    const totalRestored = Object.values(results).reduce((a, b) => a + b, 0)
    await logBackupRestoreHistory({
      req,
      action: 'restore',
      status: 'success',
      filename: sourceFilename,
      totalRecords: totalRestored,
      tableCounts: results,
    })

    res.json({ success: true, restored: results, totalRestored })
  } catch (error: any) {
    console.error("Restore error:", error)
    await logBackupRestoreHistory({
      req,
      action: 'restore',
      status: 'failed',
      filename: sourceFilename,
      errorMessage: error?.message || 'Unknown restore error',
    })
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

    const sriLankaTimestamp = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date())

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
            <strong>Test Date (Asia/Colombo):</strong> ${sriLankaTimestamp}<br>
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

Test Date (Asia/Colombo): ${sriLankaTimestamp}
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

    const sriLankaTimestamp = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date())

    // Send test SMS
    const testMessage = `DQMS Service Test: SMS service is working correctly. Time (Asia/Colombo): ${sriLankaTimestamp}`
    
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

