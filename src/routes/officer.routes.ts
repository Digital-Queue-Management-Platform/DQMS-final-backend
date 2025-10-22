import { Router } from "express"
import { prisma, broadcast } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
// No expiration for production system - officers need continuous access during shifts
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined

// Officer login with OTP (simplified - just mobile number for now)
router.post("/login", async (req, res) => {
  try {
    const { mobileNumber } = req.body

    const officer = await prisma.officer.findUnique({
      where: { mobileNumber },
      include: { outlet: true },
    })

    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    // Update last login
    await prisma.officer.update({
      where: { id: officer.id },
      data: {
        lastLoginAt: new Date(),
        status: "available",
      },
    })

    // sign JWT and set httpOnly cookie (no expiration for production)
    const tokenOptions = { officerId: officer.id }
    const signOptions: any = {}
    if (JWT_EXPIRES) {
      signOptions.expiresIn = JWT_EXPIRES
    }
    
    const token = (jwt as any).sign(tokenOptions, JWT_SECRET as jwt.Secret, signOptions)
    
    res.cookie("dq_jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // No maxAge set - cookie persists until browser is closed or explicitly cleared
      sameSite: "lax",
      path: "/",
    })

    // Also return token in response for cross-domain compatibility
    res.json({ success: true, officer, token })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Register officer
router.post("/register", async (req, res) => {
  try {
    const { name, mobileNumber, outletId, counterNumber, isTraining } = req.body

    if (!name || !mobileNumber || !outletId) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Prevent duplicate mobile
    const existing = await prisma.officer.findUnique({ where: { mobileNumber } })
    if (existing) {
      return res.status(400).json({ error: "Officer with this mobile already exists" })
    }

    // Validate outlet exists and counterNumber (if provided) is within bounds
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
    if (!outlet) {
      return res.status(400).json({ error: "Invalid outletId" })
    }

    if (counterNumber !== undefined && counterNumber !== null) {
      const parsed = Number(counterNumber)
      if (!Number.isInteger(parsed) || parsed < 0) {
        return res.status(400).json({ error: "counterNumber must be a non-negative integer" })
      }
      const max = outlet.counterCount ?? 0
      if (parsed > max) {
        return res.status(400).json({ error: `Counter number ${parsed} exceeds available counters (${max}) for this outlet` })
      }
    }

    const officer = await prisma.officer.create({
      data: {
        name,
        mobileNumber,
        outletId,
        counterNumber: counterNumber !== undefined ? counterNumber : null,
        isTraining: !!isTraining,
        status: "offline",
      },
    })

    res.json({ success: true, officer })
  } catch (error) {
    console.error("Officer register error:", error)
    res.status(500).json({ error: "Failed to register officer" })
  }
})

// Get next token in queue (supports cross-service fallback when enabled)
router.post("/next-token", async (req, res) => {
  try {
    const { officerId, allowFallback } = req.body

    const officer = await prisma.officer.findUnique({
      where: { id: officerId },
        select: {
          id: true,
          outletId: true,
          counterNumber: true,
          assignedServices: true,
        },
      })

    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

      // Parse assignedServices (JSON array)
      let assignedServices: string[] = [];
      if (officer.assignedServices) {
        try {
          if (Array.isArray(officer.assignedServices)) {
            assignedServices = officer.assignedServices as string[];
          } else if (typeof officer.assignedServices === 'string') {
            assignedServices = JSON.parse(officer.assignedServices);
          } else if (typeof officer.assignedServices === 'object') {
      assignedServices = Object.values(officer.assignedServices).filter(v => typeof v === 'string').map(v => v as string);
          } else {
            assignedServices = [];
          }
        } catch (e) {
          assignedServices = [];
        }
      }

      // Get next waiting token that matches officer's assignedServices
      const nextToken = await prisma.token.findFirst({
        where: {
          outletId: officer.outletId,
          status: "waiting",
          // Filter tokens where serviceTypes has overlap with assignedServices
          serviceTypes: {
            hasSome: assignedServices.length > 0 ? assignedServices : undefined,
          },
        },
        orderBy: { tokenNumber: "asc" },
        include: {
          customer: true,
        },
      })
    
    if (nextToken) {
      // Assign token to officer
      const updatedToken = await prisma.token.update({
        where: { id: nextToken.id },
        data: {
          status: "in_service",
          assignedTo: officerId,
          counterNumber: officer.counterNumber,
          calledAt: new Date(),
          startedAt: new Date(),
        },
        include: {
          customer: true,
          officer: true,
        },
      })

      // Update officer status
      await prisma.officer.update({
        where: { id: officerId },
        data: { status: "serving" },
      })

      // Broadcast update
      broadcast({ type: "TOKEN_CALLED", data: updatedToken })

      return res.json({ success: true, token: updatedToken, fallback: false })
    }

    // No matching token for officer's services. Consider cross-service fallback (always enabled).

    // Check if there are any waiting tokens at the outlet
    const earliestWaiting = await prisma.token.findFirst({
      where: { outletId: officer.outletId, status: 'waiting' },
      orderBy: { tokenNumber: 'asc' },
      select: { id: true, serviceTypes: true, tokenNumber: true },
    })

    if (!earliestWaiting) {
      return res.json({ message: "No tokens in queue" })
    }

    // Determine if there are any relevant officers online/available for these service types in this outlet
    const outletOfficers = await prisma.officer.findMany({
      where: { outletId: officer.outletId },
      select: { id: true, status: true, assignedServices: true },
    })

    const hasRelevantOnline = outletOfficers.some((o) => {
      if (o.status === 'offline') return false
      let svc: string[] = []
      const raw = o.assignedServices as any
      if (raw) {
        if (Array.isArray(raw)) svc = raw as string[]
        else if (typeof raw === 'string') { try { svc = JSON.parse(raw) } catch { svc = [] } }
        else if (typeof raw === 'object') svc = Object.values(raw).filter(v => typeof v === 'string') as string[]
      }
      const overlaps = (earliestWaiting.serviceTypes || []).some(s => svc.includes(s))
      return overlaps && (o.status === 'available' || o.status === 'serving' || o.status === 'on_break')
    })

    // Fallback allowed only when zero online/available relevant officers
    if (!hasRelevantOnline) {
      if (!allowFallback) {
        return res.json({ fallbackAllowed: true, fallback: true, message: 'No online/available relevant officers for the requested service types.' })
      }

      // Proceed to assign earliest waiting token regardless of service type
      const crossServiceToken = await prisma.token.findFirst({
        where: { outletId: officer.outletId, status: 'waiting' },
        orderBy: { tokenNumber: 'asc' },
        include: { customer: true },
      })

      if (!crossServiceToken) {
        return res.json({ message: "No tokens in queue" })
      }

      const updatedToken = await prisma.token.update({
        where: { id: crossServiceToken.id },
        data: {
          status: 'in_service',
          assignedTo: officerId,
          counterNumber: officer.counterNumber,
          calledAt: new Date(),
          startedAt: new Date(),
        },
        include: { customer: true, officer: true },
      })

      await prisma.officer.update({ where: { id: officerId }, data: { status: 'serving' } })

      broadcast({ type: 'TOKEN_CALLED', data: updatedToken })

      return res.json({ success: true, token: updatedToken, fallback: true })
    }

    return res.json({ message: "No tokens in queue" })
  } catch (error) {
    console.error("Next token error:", error)
    res.status(500).json({ error: "Failed to get next token" })
  }
})

// Skip current token
router.post("/skip-token", async (req, res) => {
  try {
    const { officerId, tokenId } = req.body

    if (!officerId || !tokenId) return res.status(400).json({ error: 'officerId and tokenId required' })

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) return res.status(404).json({ error: 'Officer not found' })

    const token = await prisma.token.findUnique({ where: { id: tokenId } })
    if (!token) return res.status(404).json({ error: 'Token not found' })

    // mark token as skipped
    const skipped = await prisma.token.update({
      where: { id: tokenId },
      data: {
        status: 'skipped',
        assignedTo: null,
        counterNumber: null,
      },
      include: { customer: true },
    })

    // set officer back to available
    await prisma.officer.update({ where: { id: officerId }, data: { status: 'available' } })

    // broadcast update
    broadcast({ type: 'TOKEN_SKIPPED', data: skipped })

    res.json({ success: true, token: skipped })
  } catch (error) {
    console.error('Skip token error:', error)
    res.status(500).json({ error: 'Failed to skip token' })
  }
})

// Recall skipped token
router.post("/recall-token", async (req, res) => {
  try {
    const { officerId, tokenId } = req.body

    if (!officerId || !tokenId) return res.status(400).json({ error: 'officerId and tokenId required' })

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) return res.status(404).json({ error: 'Officer not found' })

    const token = await prisma.token.findUnique({ where: { id: tokenId } })
    if (!token) return res.status(404).json({ error: 'Token not found' })
    if (token.status !== 'skipped') return res.status(400).json({ error: 'Token is not skipped' })

    // assign token back to officer
    const recalled = await prisma.token.update({
      where: { id: tokenId },
      data: {
        status: 'in_service',
        assignedTo: officerId,
        counterNumber: officer.counterNumber,
        calledAt: new Date(),
        startedAt: new Date(),
      },
      include: { customer: true, officer: true },
    })

    // set officer to serving
    await prisma.officer.update({ where: { id: officerId }, data: { status: 'serving' } })

    // broadcast update
    broadcast({ type: 'TOKEN_RECALLED', data: recalled })

    res.json({ success: true, token: recalled })
  } catch (error) {
    console.error('Recall token error:', error)
    res.status(500).json({ error: 'Failed to recall token' })
  }
})

// Complete service
router.post("/complete-service", async (req, res) => {
  try {
    const { tokenId, officerId, accountRef } = req.body

    const token = await prisma.token.update({
      where: { id: tokenId },
      data: {
        status: "completed",
        completedAt: new Date(),
        accountRef: accountRef || undefined,
      },
      include: {
        customer: true,
      },
    })

    // Update officer status back to available
    await prisma.officer.update({
      where: { id: officerId },
      data: { status: "available" },
    })

    // Broadcast update
    broadcast({ type: "TOKEN_COMPLETED", data: token })

    res.json({ success: true, token })
  } catch (error) {
    console.error("Complete service error:", error)
    res.status(500).json({ error: "Failed to complete service" })
  }
})

// Update officer status (break, resume, logout)
router.post("/status", async (req, res) => {
  try {
    const { officerId, status } = req.body

    // Validate break business rules
    if (status === 'on_break') {
      // Check if officer has an active break
      const activeBreak = await prisma.breakLog.findFirst({
        where: {
          officerId,
          endedAt: null
        }
      })

      if (activeBreak) {
        return res.status(400).json({ error: "Officer is already on a break" })
      }

      // Check if officer has served minimum time since last break (30 minutes)
      const lastBreak = await prisma.breakLog.findFirst({
        where: { officerId },
        orderBy: { endedAt: 'desc' }
      })

      if (lastBreak && lastBreak.endedAt) {
        const timeSinceLastBreak = Date.now() - lastBreak.endedAt.getTime()
        const minTimeRequired = 30 * 60 * 1000 // 30 minutes
        
        if (timeSinceLastBreak < minTimeRequired) {
          const remainingMinutes = Math.ceil((minTimeRequired - timeSinceLastBreak) / (1000 * 60))
          return res.status(400).json({ 
            error: `Must wait ${remainingMinutes} more minutes before taking another break` 
          })
        }
      }

      // Check daily break limits (max 6 breaks per day, max 90 minutes total)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const todayBreaks = await prisma.breakLog.findMany({
        where: {
          officerId,
          startedAt: {
            gte: today,
            lt: tomorrow
          }
        }
      })

      if (todayBreaks.length >= 6) {
        return res.status(400).json({ error: "Maximum daily breaks reached (6 breaks)" })
      }

      const totalBreakMinutes = todayBreaks.reduce((sum, brk) => {
        if (brk.endedAt) {
          return sum + Math.floor((brk.endedAt.getTime() - brk.startedAt.getTime()) / (1000 * 60))
        }
        return sum
      }, 0)

      if (totalBreakMinutes >= 90) {
        return res.status(400).json({ error: "Daily break time limit reached (90 minutes)" })
      }

      // Create new break log entry
      await prisma.breakLog.create({
        data: {
          id: `break_${officerId}_${Date.now()}`,
          officerId,
          startedAt: new Date()
        }
      })
    } else if (status === 'available') {
      // End any active break
      const activeBreak = await prisma.breakLog.findFirst({
        where: {
          officerId,
          endedAt: null
        }
      })

      if (activeBreak) {
        await prisma.breakLog.update({
          where: { id: activeBreak.id },
          data: { endedAt: new Date() }
        })
      }
    }

    const officer = await prisma.officer.update({
      where: { id: officerId },
      data: { status },
    })

    res.json({ success: true, officer })
  } catch (error) {
    console.error("Status update error:", error)
    res.status(500).json({ error: "Failed to update status" })
  }
})

// Start a break
router.post("/break/start", async (req, res) => {
  try {
    const { officerId } = req.body

    // Check if officer exists
    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    // Check if officer has an active break
    const activeBreak = await prisma.breakLog.findFirst({
      where: {
        officerId,
        endedAt: null
      }
    })

    if (activeBreak) {
      return res.status(400).json({ error: "Break already in progress" })
    }

    // Validate break limits (same as in status endpoint)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todayBreaks = await prisma.breakLog.findMany({
      where: {
        officerId,
        startedAt: {
          gte: today,
          lt: tomorrow
        }
      }
    })

    if (todayBreaks.length >= 6) {
      return res.status(400).json({ error: "Maximum daily breaks reached" })
    }

    // Create break log and update officer status
    const breakLog = await prisma.breakLog.create({
      data: {
        id: `break_${officerId}_${Date.now()}`,
        officerId,
        startedAt: new Date()
      }
    })

    await prisma.officer.update({
      where: { id: officerId },
      data: { status: 'on_break' }
    })

    res.json({ success: true, breakLog })
  } catch (error) {
    console.error("Start break error:", error)
    res.status(500).json({ error: "Failed to start break" })
  }
})

// End a break
router.post("/break/end", async (req, res) => {
  try {
    const { officerId } = req.body

    // Find active break
    const activeBreak = await prisma.breakLog.findFirst({
      where: {
        officerId,
        endedAt: null
      }
    })

    if (!activeBreak) {
      return res.status(400).json({ error: "No active break found" })
    }

    // End the break
    const updatedBreak = await prisma.breakLog.update({
      where: { id: activeBreak.id },
      data: { endedAt: new Date() }
    })

    // Update officer status to available
    await prisma.officer.update({
      where: { id: officerId },
      data: { status: 'available' }
    })

    const durationMinutes = Math.floor(
      (updatedBreak.endedAt!.getTime() - updatedBreak.startedAt.getTime()) / (1000 * 60)
    )

    res.json({ 
      success: true, 
      breakLog: updatedBreak,
      durationMinutes
    })
  } catch (error) {
    console.error("End break error:", error)
    res.status(500).json({ error: "Failed to end break" })
  }
})

// Get active break status
router.get("/break/active/:officerId", async (req, res) => {
  try {
    const { officerId } = req.params

    const activeBreak = await prisma.breakLog.findFirst({
      where: {
        officerId,
        endedAt: null
      }
    })

    if (!activeBreak) {
      return res.json({ activeBreak: null })
    }

    const durationMinutes = Math.floor(
      (Date.now() - activeBreak.startedAt.getTime()) / (1000 * 60)
    )

    res.json({ 
      activeBreak: {
        id: activeBreak.id,
        startedAt: activeBreak.startedAt.toISOString(),
        durationMinutes
      }
    })
  } catch (error) {
    console.error("Get active break error:", error)
    res.status(500).json({ error: "Failed to get active break" })
  }
})

// Get officer dashboard stats
router.get("/stats/:officerId", async (req, res) => {
  try {
    const { officerId } = req.params

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const tokensHandled = await prisma.token.count({
      where: {
        assignedTo: officerId,
        completedAt: { gte: today },
      },
    })

    const avgRating = await prisma.feedback.aggregate({
      where: {
        token: {
          assignedTo: officerId,
          completedAt: { gte: today },
        },
      },
      _avg: { rating: true },
    })

    const currentToken = await prisma.token.findFirst({
      where: {
        assignedTo: officerId,
        status: "in_service",
      },
      include: { customer: true },
    })

    res.json({
      tokensHandled,
      avgRating: avgRating._avg.rating || 0,
      currentToken,
    })
  } catch (error) {
    console.error("Stats error:", error)
    res.status(500).json({ error: "Failed to fetch stats" })
  }
})

// Get current officer from JWT cookie
router.get("/me", async (req, res) => {
  try {
    // Check for JWT token in cookie or Authorization header
    let token = req.cookies?.dq_jwt
    
    // If no cookie, check Authorization header
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }
    
    if (!token) return res.status(401).json({ error: "Not authenticated" })

    let payload: any
    try {
      payload = (jwt as any).verify(token, JWT_SECRET)
    } catch (e) {
      return res.status(401).json({ error: "Invalid token" })
    }

    const officer = await prisma.officer.findUnique({ where: { id: payload.officerId }, include: { outlet: true } })
    if (!officer) return res.status(404).json({ error: "Officer not found" })

    res.json({ officer })
  } catch (error) {
    console.error("/me error:", error)
    res.status(500).json({ error: "Failed to get officer" })
  }
})

// Officer Summary Endpoints for Dashboard
// Get served tokens summary
router.get("/summary/served/:officerId", async (req, res) => {
  try {
    const { officerId } = req.params

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    // Get tokens served by this officer today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const tokens = await prisma.token.findMany({
      where: {
        assignedTo: officerId,
        status: { in: ["completed", "served"] },
        completedAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      include: {
        customer: true,
      },
      orderBy: { completedAt: "desc" },
    })

    // Calculate average handling time
    const totalMinutes = tokens.reduce((sum, token) => {
      if (token.startedAt && token.completedAt) {
        const diff = token.completedAt.getTime() - token.startedAt.getTime()
        return sum + (diff / 1000 / 60) // Convert to minutes
      }
      return sum
    }, 0)

    const avgHandleMinutes = tokens.length > 0 ? Math.round(totalMinutes / tokens.length * 100) / 100 : 0

    res.json({
      total: tokens.length,
      avgHandleMinutes,
      tokens: tokens.map(token => ({
        ...token,
        customerName: token.customer?.name || 'Anonymous',
        serviceNames: Array.isArray(token.serviceTypes) && token.serviceTypes.length > 0 ? token.serviceTypes : ['General Service'],
      })),
    })
  } catch (error) {
    console.error("Get served summary error:", error)
    res.status(500).json({ error: "Failed to get served summary" })
  }
})

// Get breaks summary
router.get("/summary/breaks/:officerId", async (req, res) => {
  try {
    const { officerId } = req.params

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    // Get today's breaks from BreakLog table
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const breaks = await prisma.breakLog.findMany({
      where: {
        officerId,
        startedAt: {
          gte: today,
          lt: tomorrow
        }
      },
      orderBy: { startedAt: 'desc' }
    })

    // Calculate break statistics
    const breakData = breaks.map(brk => {
      const startTime = new Date(brk.startedAt)
      const endTime = brk.endedAt ? new Date(brk.endedAt) : null
      const durationMinutes = endTime 
        ? Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60))
        : Math.floor((new Date().getTime() - startTime.getTime()) / (1000 * 60))

      return {
        id: brk.id,
        startedAt: brk.startedAt.toISOString(),
        endedAt: brk.endedAt?.toISOString() || null,
        durationMinutes,
        isActive: !brk.endedAt
      }
    })

    const totalBreaks = breaks.length
    const totalMinutes = breakData.reduce((sum, brk) => sum + brk.durationMinutes, 0)
    const activeBreak = breakData.find(brk => brk.isActive)

    res.json({
      totalBreaks,
      totalMinutes,
      breaks: breakData,
      activeBreak: activeBreak || null
    })
  } catch (error) {
    console.error("Get breaks summary error:", error)
    res.status(500).json({ error: "Failed to get breaks summary" })
  }
})

// Get feedback summary
router.get("/summary/feedback/:officerId", async (req, res) => {
  try {
    const { officerId } = req.params

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    // Get feedback for tokens served by this officer
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Get tokens with feedback from today
    const tokensWithFeedback = await prisma.token.findMany({
      where: {
        assignedTo: officerId,
        status: { in: ["completed", "served"] },
        completedAt: {
          gte: today,
          lt: tomorrow,
        },
        feedback: {
          isNot: null, // Has feedback (one-to-one relationship)
        },
      },
      include: {
        customer: true,
        feedback: true,
      },
      orderBy: { completedAt: "desc" },
    })

    // Calculate average rating
    const feedbackList = tokensWithFeedback
      .filter(token => token.feedback !== null)
      .map(token => {
        const feedback = token.feedback!
        return {
          tokenId: token.id,
          tokenNumber: token.tokenNumber,
          rating: feedback.rating,
          comment: feedback.comment || "",
          customerName: token.customer?.name || "Anonymous",
          createdAt: feedback.createdAt.toISOString(),
        }
      })

    const totalRating = feedbackList.reduce((sum, fb) => sum + fb.rating, 0)
    const avgRating = feedbackList.length > 0 ? Math.round((totalRating / feedbackList.length) * 100) / 100 : 0

    res.json({
      total: feedbackList.length,
      avgRating,
      feedback: feedbackList,
    })
  } catch (error) {
    console.error("Get feedback summary error:", error)
    res.status(500).json({ error: "Failed to get feedback summary" })
  }
})

// Logout: clear cookie
router.post("/logout", async (req, res) => {
  try {
    res.clearCookie("dq_jwt", { path: "/" })
    res.json({ success: true })
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json({ error: "Logout failed" })
  }
})

export default router
