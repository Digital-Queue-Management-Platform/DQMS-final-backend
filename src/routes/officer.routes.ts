import { Router } from "express"
import { prisma, broadcast } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h"

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

    // Get next waiting token
    const nextToken = await prisma.token.findFirst({
      where: {
        outletId: officer.outletId,
        status: "waiting",
      },
      orderBy: { tokenNumber: "asc" },
      include: {
        customer: true,
      },
    })

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
