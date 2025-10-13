import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h"

// Manager login - authenticate using email
router.post("/login", async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: "Email is required" })
    }

    // Find manager by email in the Region model
    const region = await prisma.region.findFirst({
      where: {
        managerEmail: email,
      },
      include: {
        outlets: {
          include: {
            officers: true,
          }
        }
      }
    })

    if (!region) {
      return res.status(401).json({ error: "Manager not found" })
    }

    // Create manager object from region data
    const manager = {
      id: region.managerId,
      email: region.managerEmail,
      mobile: region.managerMobile,
      regionId: region.id,
      regionName: region.name,
      outlets: region.outlets
    }

    // Create JWT token for manager authentication
    const token = (jwt as any).sign(
      { managerId: region.managerId, email: region.managerEmail, regionId: region.id }, 
      JWT_SECRET as jwt.Secret, 
      { expiresIn: JWT_EXPIRES }
    )

    // Set httpOnly cookie
    res.cookie("dq_manager_jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      sameSite: "lax",
      path: "/",
    })

    res.json({
      success: true,
      manager,
      token,
      message: "Login successful"
    })
  } catch (error) {
    console.error("Manager login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Get manager profile
router.get("/me", async (req, res) => {
  try {
    // Check for JWT token in cookie or Authorization header
    let token = req.cookies?.dq_manager_jwt
    
    // If no cookie, check Authorization header
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }
    
    let managerEmail: string | undefined

    if (token) {
      // Try JWT authentication first
      try {
        const payload = (jwt as any).verify(token, JWT_SECRET)
        managerEmail = payload.email
      } catch (e) {
        return res.status(401).json({ error: "Invalid or expired token. Please login again." })
      }
    } else {
      // Fallback: check for email in query params or body (for backwards compatibility)
      managerEmail = (req.query.email as string) || (req.body?.email)
      
      if (!managerEmail) {
        return res.status(401).json({ error: "Manager authentication required. Please login again." })
      }
    }

    // Find region using the manager email
    const region = await prisma.region.findFirst({
      where: { managerEmail: managerEmail },
      include: {
        outlets: {
          include: {
            officers: true,
          }
        }
      }
    })

    if (!region) {
      return res.status(404).json({ error: "Manager not found" })
    }

    const manager = {
      id: region.managerId,
      email: region.managerEmail,
      mobile: region.managerMobile,
      regionId: region.id,
      regionName: region.name,
      outlets: region.outlets
    }

    res.json({ manager })
  } catch (error) {
    console.error("Manager profile fetch error:", error)
    res.status(500).json({ error: "Failed to fetch manager profile" })
  }
})

// Get manager's region analytics
router.get("/analytics", async (req, res) => {
  try {
    const { managerId, email, startDate, endDate } = req.query

    // Find the manager's region
    let region
    if (managerId) {
      region = await prisma.region.findFirst({
        where: { managerId: managerId as string },
        include: { outlets: true }
      })
    } else if (email) {
      region = await prisma.region.findFirst({
        where: { managerEmail: email as string },
        include: { outlets: true }
      })
    } else {
      return res.status(400).json({ error: "Manager ID or email is required" })
    }

    if (!region) {
      return res.status(404).json({ error: "Manager not found" })
    }

    const outletIds = region.outlets.map(outlet => outlet.id)

    const where: any = {
      status: "completed",
      outletId: { in: outletIds },
    }

    if (startDate && endDate) {
      where.completedAt = {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      }
    }

    // Get analytics for the manager's region
    const totalTokens = await prisma.token.count({ where })
    
    const completedTokens = await prisma.token.findMany({
      where,
      select: {
        createdAt: true,
        startedAt: true,
        completedAt: true,
      }
    })

    // Calculate average waiting and service times
    let totalWaitTime = 0
    let totalServiceTime = 0
    let validWaitTimes = 0
    let validServiceTimes = 0

    completedTokens.forEach(token => {
      if (token.startedAt && token.createdAt) {
        totalWaitTime += (token.startedAt.getTime() - token.createdAt.getTime()) / (1000 * 60)
        validWaitTimes++
      }
      if (token.completedAt && token.startedAt) {
        totalServiceTime += (token.completedAt.getTime() - token.startedAt.getTime()) / (1000 * 60)
        validServiceTimes++
      }
    })

    const avgWaitTime = validWaitTimes > 0 ? totalWaitTime / validWaitTimes : 0
    const avgServiceTime = validServiceTimes > 0 ? totalServiceTime / validServiceTimes : 0

    // Get feedback stats
    const feedbackStats = await prisma.feedback.groupBy({
      by: ['rating'],
      _count: true,
      where: {
        token: {
          outletId: { in: outletIds },
          completedAt: startDate && endDate ? {
            gte: new Date(startDate as string),
            lte: new Date(endDate as string),
          } : undefined
        }
      }
    })

    res.json({
      regionName: region.name,
      totalTokens,
      avgWaitTime: Math.round(avgWaitTime * 10) / 10,
      avgServiceTime: Math.round(avgServiceTime * 10) / 10,
      feedbackStats,
      outletsCount: region.outlets.length,
      outlets: region.outlets
    })
  } catch (error) {
    console.error("Manager analytics error:", error)
    res.status(500).json({ error: "Failed to fetch analytics" })
  }
})

// Get officers in manager's region
router.get("/officers", async (req, res) => {
  try {
    // Check for JWT token
    let token = req.cookies?.dq_manager_jwt
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }
    
    let managerEmail: string | undefined

    if (token) {
      // Try JWT authentication first
      try {
        const payload = (jwt as any).verify(token, JWT_SECRET)
        managerEmail = payload.email
      } catch (e) {
        return res.status(401).json({ error: "Invalid token" })
      }
    } else {
      // Fallback: check for email in query params or headers
      managerEmail = (req.query.email as string) || (req.headers['x-manager-email'] as string)
      
      if (!managerEmail) {
        return res.status(401).json({ error: "Manager authentication required" })
      }
    }

    // Find manager's region
    const region = await prisma.region.findFirst({
      where: { managerEmail: managerEmail },
      include: { outlets: true }
    })

    if (!region) {
      return res.status(404).json({ error: "Manager not found" })
    }

    const outletIds = region.outlets.map(outlet => outlet.id)

    // Get officers in this manager's outlets
    const officers = await prisma.officer.findMany({
      where: {
        outletId: { in: outletIds }
      },
      include: {
        outlet: true
      }
    })

    res.json(officers)
  } catch (error) {
    console.error("Manager officers fetch error:", error)
    res.status(500).json({ error: "Failed to fetch officers" })
  }
})

// Create new officer in manager's region
router.post("/officers", async (req, res) => {
  try {
    const { name, mobileNumber, outletId, counterNumber, isTraining, languages } = req.body
    
    // Check for JWT token
    let token = req.cookies?.dq_manager_jwt
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }
    
    let managerEmail: string | undefined

    if (token) {
      // Try JWT authentication first
      try {
        const payload = (jwt as any).verify(token, JWT_SECRET)
        managerEmail = payload.email
      } catch (e) {
        return res.status(401).json({ error: "Invalid token" })
      }
    } else {
      // Fallback: check for email in query params or headers
      managerEmail = (req.query.email as string) || (req.headers['x-manager-email'] as string)
      
      if (!managerEmail) {
        return res.status(401).json({ error: "Manager authentication required" })
      }
    }

    // Find manager's region
    const region = await prisma.region.findFirst({
      where: { managerEmail: managerEmail },
      include: { outlets: true }
    })

    if (!region) {
      return res.status(404).json({ error: "Manager not found" })
    }

    // Verify the outlet belongs to this manager's region
    const outlet = region.outlets.find(o => o.id === outletId)
    if (!outlet) {
      return res.status(403).json({ error: "Outlet not found in your region" })
    }

    // Create the officer
    const officerData: any = {
      name,
      mobileNumber,
      outletId,
    }

    if (counterNumber !== undefined) {
      officerData.counterNumber = counterNumber
    }

    if (isTraining !== undefined) {
      officerData.isTraining = isTraining
    }

    if (languages && languages.length > 0) {
      officerData.assignedServices = languages
    }

    const officer = await prisma.officer.create({
      data: officerData,
      include: {
        outlet: true
      }
    })

    res.json(officer)
  } catch (error) {
    console.error("Manager officer creation error:", error)
    res.status(500).json({ error: "Failed to create officer" })
  }
})

// Manager logout
router.post("/logout", async (req, res) => {
  try {
    // Clear any server-side session data here if using sessions
    // For now, just return success as the frontend will clear localStorage
    res.json({ success: true, message: "Logged out successfully" })
  } catch (error) {
    console.error("Manager logout error:", error)
    res.status(500).json({ error: "Logout failed" })
  }
})

export default router