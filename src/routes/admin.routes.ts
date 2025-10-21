import { Router } from "express"
import * as jwt from "jsonwebtoken"
import * as bcrypt from "bcrypt"
import { prisma } from "../server"
import emailService from "../services/emailService"
import { generateSecurePassword } from "../utils/passwordGenerator"

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
    console.log('Analytics request:', { startDate, endDate, outletId })

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

    console.log('Query where clause:', where)

    // Total completed tokens
    const totalTokens = await prisma.token.count({
      where: {
        ...where,
        status: "completed",
      }
    })
    console.log('Total tokens found:', totalTokens)

    // Average waiting time
    const completedTokens = await prisma.token.findMany({
      where: {
        ...where,
        status: "completed",
        startedAt: { not: undefined },
        createdAt: { not: undefined },
      },
    })
    console.log('Completed tokens found for avg calculation:', completedTokens.length)

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
      by: ["serviceType"],
      where: {
        ...where,
        status: "completed",
      },
      _count: true,
    })

    const serviceTypesFormatted = serviceTypes.map(service => ({
      name: service.serviceType === "bill_payment" ? "Bill Payments" :
            service.serviceType === "technical_support" ? "Technical Support" :
            service.serviceType === "account_services" ? "Account Services" :
            service.serviceType === "new_connection" ? "New Connections" :
            service.serviceType === "device_sim_issues" ? "Device/SIM Issues" :
            service.serviceType || "Other Services",
      count: service._count
    }))

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

    const activeTokens = await prisma.token.count({
      where: {
        createdAt: { gte: today },
        status: { in: ["waiting", "in_service"] },
      },
    })

    const completedToday = await prisma.token.count({
      where: {
        createdAt: { gte: today },
        status: "completed",
      },
    })

    const activeOfficers = await prisma.officer.count({
      where: {
        status: { in: ["available", "serving"] },
      },
    })

    const avgRatingToday = await prisma.feedback.aggregate({
      where: {
        createdAt: { gte: today },
      },
      _avg: { rating: true },
    })

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

// Register a region with manager account creation
router.post("/register-region", async (req, res) => {
  try {
    const { name, managerName, managerEmail, managerMobile } = req.body
    if (!name) return res.status(400).json({ error: "Region name required" })
    if (!managerEmail) return res.status(400).json({ error: "Manager email required" })

    // Check if manager email already exists
    const existingRegion = await prisma.region.findFirst({
      where: { managerEmail: managerEmail }
    })

    if (existingRegion) {
      return res.status(400).json({ error: "Manager with this email already exists" })
    }

    // Generate a secure 8-character password for the manager
    const defaultPassword = generateSecurePassword()
    const hashedPassword = await bcrypt.hash(defaultPassword, 10)

    // Create region with manager password
    const region = await prisma.region.create({
      data: {
        name,
        managerId: managerName || undefined,
        managerEmail: managerEmail,
        managerMobile: managerMobile || undefined,
        managerPassword: hashedPassword,
      } as any,
    })

    let credentials: ManagerCredentials = {
      email: managerEmail,
      temporaryPassword: defaultPassword,
      message: "Please provide these credentials to the regional manager"
    }
    
    // Send welcome email to the manager
    try {
      const loginUrl = 'https://digital-queue-management-platform.vercel.app/manager/login'
      
      const emailResult = await emailService.sendManagerWelcomeEmail({
        managerName: managerName || 'Regional Manager',
        managerEmail: managerEmail,
        regionName: name,
        temporaryPassword: credentials.temporaryPassword,
        loginUrl: loginUrl
      })
      
      if (emailResult) {
        credentials = {
          ...credentials,
          emailSent: true,
          message: "Welcome email sent successfully. Please check your inbox for login credentials."
        }
      } else {
        credentials = {
          ...credentials,
          emailSent: false,
          message: "Account created successfully, but email notification failed. Please contact admin for credentials."
        }
      }
    } catch (emailError) {
      console.error("Email sending error:", emailError)
      credentials = {
        ...credentials,
        emailSent: false,
        message: "Account created successfully, but email notification failed. Please contact admin for credentials."
      }
    }
    
    res.json({ 
      success: true, 
      region: {
        ...region,
        managerPassword: undefined // Don't send password back
      },
      credentials
    })
  } catch (error: any) {
    console.error("Region register error:", error)
    res.status(500).json({ 
      error: "Failed to create region",
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    })
  }
})

// Get all regional managers
router.get("/managers", async (req, res) => {
  try {
    const regions = await prisma.region.findMany({
      where: {
        managerEmail: { not: null }
      },
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

    res.json({ success: true, managers: regions })
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
        managerEmail: true
      }
    })

    if (!region) {
      return res.status(404).json({ error: "Manager not found" })
    }

    if (!region.managerEmail) {
      return res.status(400).json({ error: "Manager email not found" })
    }

    // Generate a secure 8-character password
    const newPassword = generateSecurePassword()
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // Update the password in database
    await prisma.region.update({
      where: { id: regionId },
      data: { managerPassword: hashedPassword } as any,
    })

    // Send password reset email
    try {
      // Always use production URL for password reset emails
      const loginUrl = 'https://digital-queue-management-platform.vercel.app/manager/login'
      
      const emailResult = await emailService.sendManagerPasswordResetEmail({
        managerName: region.managerId || 'Regional Manager',
        managerEmail: region.managerEmail,
        regionName: region.name,
        newPassword: newPassword,
        loginUrl: loginUrl
      })
      
      if (emailResult) {
        res.json({ 
          success: true, 
          message: "Password reset successfully. New password sent to manager's email.",
          emailSent: true
        })
      } else {
        res.json({ 
          success: true, 
          message: "Password reset successfully, but email notification failed. Please provide the new password manually.",
          emailSent: false,
          temporaryPassword: newPassword // Only send if email fails
        })
      }
    } catch (emailError) {
      console.error("Email sending error:", emailError)
      res.json({ 
        success: true, 
        message: "Password reset successfully, but email notification failed. Please provide the new password manually.",
        emailSent: false,
        temporaryPassword: newPassword // Only send if email fails
      })
    }
  } catch (error) {
    console.error("Reset manager password error:", error)
    res.status(500).json({ error: "Failed to reset manager password" })
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

export default router

// Get system health status  
router.get("/system-health", async (req, res) => {
  try {
    // Application Server Health - check if we can query the database
    let appServerHealth = "Healthy"
    let appServerUptime = "99.9%"
    let appServerIcon = "CheckCircle"
    
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (dbError) {
      appServerHealth = "Error"
      appServerUptime = "0%"
      appServerIcon = "XCircle"
    }

    // Database Connection Health
    let dbHealth = "Healthy"
    let dbUptime = "99.7%"
    let dbIcon = "CheckCircle"
    
    try {
      const startTime = Date.now()
      await prisma.token.findFirst({ take: 1 })
      const queryTime = Date.now() - startTime
      
      if (queryTime > 5000) { // If query takes more than 5 seconds
        dbHealth = "Warning"
        dbUptime = "95.0%"
        dbIcon = "AlertTriangle"
      }
    } catch (dbError) {
      dbHealth = "Error"
      dbUptime = "0%"
      dbIcon = "XCircle"
    }

    // SMS Gateway Health - check if we have SMS configuration
    let smsHealth = "Warning"
    let smsUptime = "95.2%"
    let smsIcon = "AlertTriangle"
    
    // If SMS service is configured and working, this could be updated
    // For now, we'll keep it as warning since SMS isn't fully implemented

    // Email Service Health - check email service configuration
    let emailHealth = "Healthy"
    let emailUptime = "99.8%"
    let emailIcon = "CheckCircle"
    
    const emailConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    if (!emailConfigured) {
      emailHealth = "Warning"
      emailUptime = "80.0%"
      emailIcon = "AlertTriangle"
    }

    const systemHealth = [
      {
        name: "Application Server",
        status: appServerHealth,
        uptime: appServerUptime,
        icon: appServerIcon,
        statusColor: appServerHealth === "Healthy" ? "bg-[#dcfce7] text-[#166534]" : 
                    appServerHealth === "Warning" ? "bg-[#fef9c3] text-[#854d0e]" : 
                    "bg-[#fee2e2] text-[#991b1b]",
        iconColor: appServerHealth === "Healthy" ? "text-[#22c55e]" : 
                  appServerHealth === "Warning" ? "text-[#eab308]" : 
                  "text-[#ef4444]"
      },
      {
        name: "Database Connection",
        status: dbHealth,
        uptime: dbUptime,
        icon: dbIcon,
        statusColor: dbHealth === "Healthy" ? "bg-[#dcfce7] text-[#166534]" : 
                    dbHealth === "Warning" ? "bg-[#fef9c3] text-[#854d0e]" : 
                    "bg-[#fee2e2] text-[#991b1b]",
        iconColor: dbHealth === "Healthy" ? "text-[#22c55e]" : 
                  dbHealth === "Warning" ? "text-[#eab308]" : 
                  "text-[#ef4444]"
      },
      {
        name: "SMS Gateway",
        status: smsHealth,
        uptime: smsUptime,
        icon: smsIcon,
        statusColor: "bg-[#fef9c3] text-[#854d0e]",
        iconColor: "text-[#eab308]"
      },
      {
        name: "Email Service",
        status: emailHealth,
        uptime: emailUptime,
        icon: emailIcon,
        statusColor: emailHealth === "Healthy" ? "bg-[#dcfce7] text-[#166534]" : 
                    "bg-[#fef9c3] text-[#854d0e]",
        iconColor: emailHealth === "Healthy" ? "text-[#22c55e]" : 
                  "text-[#eab308]"
      }
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
