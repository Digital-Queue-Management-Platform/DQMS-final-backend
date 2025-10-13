import { Router } from "express"
import { prisma, broadcast } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h"
const DAILY_BREAK_LIMIT = Number(process.env.DAILY_BREAK_LIMIT || 5)

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

    // sign JWT and set httpOnly cookie
  const token = (jwt as any).sign({ officerId: officer.id }, JWT_SECRET as jwt.Secret, { expiresIn: JWT_EXPIRES })
    res.cookie("dq_jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: "lax",
      path: "/",
    })

    res.json({ success: true, officer })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Register officer
router.post("/register", async (req, res) => {
  try {
    const { name, mobileNumber, outletId, counterNumber, isTraining, languages } = req.body

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
    if (!outlet.isActive) {
      return res.status(400).json({ error: "Outlet is inactive" })
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

    // Validate languages (optional)
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
        counterNumber: counterNumber !== undefined ? counterNumber : null,
        isTraining: !!isTraining,
        languages: langs ? (langs as any) : undefined,
        status: "offline",
      } as any),
    })

    res.json({ success: true, officer })
  } catch (error) {
    console.error("Officer register error:", error)
    res.status(500).json({ error: "Failed to register officer" })
  }
})

// Get next token in queue
router.post("/next-token", async (req, res) => {
  try {
    const { officerId } = req.body

    const officer = await prisma.officer.findUnique({
      where: { id: officerId },
    })

    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    // Get next waiting token with language matching
    const officerLangs = Array.isArray((officer as any).languages) ? ((officer as any).languages as string[]) : []

    let nextToken: any = null
    // Prefer matching tokens first if officer has languages configured
    if (officerLangs.length > 0) {
      const candidates = await prisma.token.findMany({
        where: { outletId: officer.outletId, status: 'waiting' },
        orderBy: { tokenNumber: 'asc' },
        take: 50,
        select: ({ id: true, tokenNumber: true, preferredLanguages: true } as any),
      }) as any
      const match = candidates.find((t: any) => {
        const prefs = Array.isArray(t.preferredLanguages) ? (t.preferredLanguages as string[]) : []
        return prefs.length === 0 || prefs.some(p => officerLangs.includes(p))
      })
      if (match) {
        nextToken = await prisma.token.findUnique({ where: { id: match.id }, include: { customer: true } })
      }
    }

    // Fallback: earliest waiting token if none matched (or officer has no languages)
    if (!nextToken) {
      nextToken = await prisma.token.findFirst({
        where: { outletId: officer.outletId, status: 'waiting' },
        orderBy: { tokenNumber: 'asc' },
        include: { customer: true },
      })
    }

    if (!nextToken) {
      return res.json({ message: "No tokens in queue" })
    }

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

    res.json({ success: true, token: updatedToken })
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

    // Transition handling for break logs
    const current = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!current) return res.status(404).json({ error: 'Officer not found' })

    // If going on break, enforce daily limit and create a new BreakLog if none open
    if (status === 'on_break') {
      try {
        const prismaAny: any = prisma
        // Count breaks started today
        const start = new Date(); start.setHours(0,0,0,0)
        const todayCount = await prismaAny.breakLog.count({ where: { officerId, startedAt: { gte: start } } })
        if (todayCount >= DAILY_BREAK_LIMIT) {
          return res.status(429).json({ error: `Daily break limit reached (${DAILY_BREAK_LIMIT})` })
        }
        const open = await prismaAny.breakLog.findFirst({ where: { officerId, endedAt: null } })
        if (!open) {
          await prismaAny.breakLog.create({ data: { officerId } })
        }
      } catch (e) {
        console.warn('BreakLog create skipped (likely schema not applied):', e?.toString?.() || e)
      }
    }

    // If resuming or going offline, close any open break log
    if ((status === 'available' || status === 'offline')) {
      try {
        const prismaAny: any = prisma
        await prismaAny.breakLog.updateMany({ where: { officerId, endedAt: null }, data: { endedAt: new Date() } })
      } catch (e) {
        console.warn('BreakLog close skipped (likely schema not applied):', e?.toString?.() || e)
      }
    }

    const officer = await prisma.officer.update({ where: { id: officerId }, data: { status } })

    res.json({ success: true, officer })
  } catch (error) {
    console.error("Status update error:", error)
    res.status(500).json({ error: "Failed to update status" })
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
    const token = req.cookies?.dq_jwt
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

// Additional summaries
router.get('/summary/served/:officerId', async (req, res) => {
  try {
    const { officerId } = req.params
    const start = new Date()
    start.setHours(0,0,0,0)
    const end = new Date()
    end.setHours(23,59,59,999)

    const tokens = await prisma.token.findMany({
      where: {
        assignedTo: officerId,
        status: 'completed',
        completedAt: { gte: start, lte: end },
      },
      orderBy: { completedAt: 'desc' },
      include: { customer: true },
    })

    const total = tokens.length
    const avgHandleMinutes = total
      ? Math.round(tokens.reduce((sum, t) => sum + ((new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime())/60000), 0) / total)
      : 0

    res.json({ total, avgHandleMinutes, tokens })
  } catch (error) {
    console.error('served summary error:', error)
    res.status(500).json({ error: 'Failed to load served summary' })
  }
})

router.get('/summary/breaks/:officerId', async (req, res) => {
  try {
    const { officerId } = req.params
    const start = new Date()
    start.setHours(0,0,0,0)
    const end = new Date()
    end.setHours(23,59,59,999)

    const prismaAny: any = prisma
    const breaks = await prismaAny.breakLog.findMany({
      where: { officerId, startedAt: { gte: start, lte: end } },
      orderBy: { startedAt: 'desc' },
    })

    // Compute durations
    const withDur = breaks.map((b: any) => ({
      ...b,
      durationMinutes: Math.round(((b.endedAt ? new Date(b.endedAt).getTime() : Date.now()) - new Date(b.startedAt).getTime())/60000),
    }))
    const totalBreaks = withDur.length
    const totalMinutes = withDur.reduce((s: number, b: any) => s + b.durationMinutes, 0)

    res.json({ totalBreaks, totalMinutes, breaks: withDur })
  } catch (error) {
    console.error('breaks summary error:', error)
    res.status(500).json({ error: 'Failed to load breaks summary' })
  }
})

// Feedback summary for officer (today)
router.get('/summary/feedback/:officerId', async (req, res) => {
  try {
    const { officerId } = req.params
    const start = new Date(); start.setHours(0,0,0,0)
    const end = new Date(); end.setHours(23,59,59,999)

    // Find tokens completed today by this officer and join feedback
    const tokens = await prisma.token.findMany({
      where: { assignedTo: officerId, status: 'completed', completedAt: { gte: start, lte: end } },
      orderBy: { completedAt: 'desc' },
      include: { feedback: true, customer: true },
    })

    const items = tokens
      .filter(t => t.feedback)
      .map(t => ({
        tokenId: t.id,
        tokenNumber: t.tokenNumber,
        rating: t.feedback!.rating,
        comment: t.feedback!.comment || '',
        customerName: t.customer?.name || 'Customer',
        createdAt: t.feedback!.createdAt,
      }))

    const avgRating = items.length ? items.reduce((s, i) => s + i.rating, 0) / items.length : 0
    res.json({ total: items.length, avgRating, feedback: items })
  } catch (error) {
    console.error('feedback summary error:', error)
    res.status(500).json({ error: 'Failed to load feedback summary' })
  }
})
