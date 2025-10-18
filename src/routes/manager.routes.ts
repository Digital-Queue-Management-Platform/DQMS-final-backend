import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"
import * as bcrypt from "bcrypt"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
// No expiration for production system - managers need continuous access
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined

// Manager login - authenticate using email and password
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" })
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

    // Check if manager has a password set (for new JWT auth)
    // If no password is set, fall back to email-only authentication for backward compatibility
    const regionWithPassword = region as any
    if (regionWithPassword.managerPassword) {
      // New JWT authentication with password
      const isPasswordValid = await bcrypt.compare(password, regionWithPassword.managerPassword)
      if (!isPasswordValid) {
        return res.status(401).json({ error: "Invalid password" })
      }
    } else {
      // Backward compatibility: email-only authentication
      if (!password) {
        // If no password provided and no password in DB, treat as legacy email-only login
        console.log("Using legacy email-only authentication for manager:", email)
      } else {
        return res.status(401).json({ error: "Manager account not yet configured for password authentication. Please contact admin." })
      }
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

    // Create JWT token for manager authentication (no expiration)
    const tokenOptions: any = { 
      managerId: region.managerId, 
      email: region.managerEmail, 
      regionId: region.id 
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

    // Set httpOnly cookie (no expiration for production)
    res.cookie("dq_manager_jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // No maxAge set - cookie persists until browser is closed or explicitly cleared
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

// Manager logout
router.post("/logout", async (req, res) => {
  try {
    // Clear the JWT cookie
    res.clearCookie("dq_manager_jwt", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    })

    res.json({
      success: true,
      message: "Logged out successfully"
    })
  } catch (error) {
    console.error("Manager logout error:", error)
    res.status(500).json({ error: "Logout failed" })
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
        console.log("Manager JWT verified successfully for:", managerEmail)
      } catch (e: any) {
        console.log("Manager JWT verification failed:", e.message || e)
        return res.status(401).json({ error: "Session expired. Please login again." })
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
      // Fallback: check for email in various places
      managerEmail = (req.query.email as string) || 
                    (req.headers['x-manager-email'] as string) ||
                    req.body.managerEmail || 
                    req.body.email
      
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

    console.log("Creating officer with data:", JSON.stringify(officerData, null, 2))
    
    const officer = await prisma.officer.create({
      data: officerData,
      include: {
        outlet: true
      }
    })

    res.json({ success: true, officer })
  } catch (error: any) {
    console.error("Manager officer creation error:", error)
    console.error("Request body:", req.body)
    
    // Provide more specific error messages
    if (error.code === 'P2002') {
      res.status(400).json({ error: "An officer with this mobile number already exists" })
    } else if (error.code === 'P2003') {
      res.status(400).json({ error: "Invalid outlet ID" })
    } else {
      res.status(500).json({ error: "Failed to create officer", details: error.message || "Unknown error" })
    }
  }
})

// Update existing officer in manager's region
router.patch("/officer/:officerId", async (req, res) => {
  try {
    const { officerId } = req.params
    const { name, counterNumber, assignedServices, isTraining, languages } = req.body
    
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
      // Fallback: check for email in various places
      managerEmail = (req.query.email as string) || 
                    (req.headers['x-manager-email'] as string) ||
                    req.body.managerEmail || 
                    req.body.email
      
      if (!managerEmail) {
        return res.status(401).json({ error: "Manager authentication required" })
      }
    }

    // Find manager's region
    const region = await prisma.region.findFirst({
      where: { managerEmail: managerEmail },
      include: { 
        outlets: {
          include: {
            officers: true
          }
        } 
      }
    })

    if (!region) {
      return res.status(404).json({ error: "Manager not found" })
    }

    // Verify the officer belongs to this manager's region
    const officerExists = region.outlets.some(outlet => 
      outlet.officers.some(officer => officer.id === officerId)
    )

    if (!officerExists) {
      return res.status(403).json({ error: "Officer not found in your region" })
    }

    // Prepare update data
    const updateData: any = {}
    
    if (name !== undefined) updateData.name = name
    if (counterNumber !== undefined) updateData.counterNumber = counterNumber
    if (isTraining !== undefined) updateData.isTraining = isTraining
    if (assignedServices !== undefined) updateData.assignedServices = assignedServices
    if (languages !== undefined) updateData.assignedServices = languages

    console.log("Updating officer with data:", JSON.stringify(updateData, null, 2))
    
    const updatedOfficer = await prisma.officer.update({
      where: { id: officerId },
      data: updateData,
      include: {
        outlet: true
      }
    })

    res.json({ success: true, officer: updatedOfficer })
  } catch (error: any) {
    console.error("Manager officer update error:", error)
    console.error("Request body:", req.body)
    
    if (error.code === 'P2002') {
      res.status(400).json({ error: "An officer with this mobile number already exists" })
    } else if (error.code === 'P2025') {
      res.status(404).json({ error: "Officer not found" })
    } else {
      res.status(500).json({ error: "Failed to update officer", details: error.message || "Unknown error" })
    }
  }
})

// Get outlets in manager's region
router.get("/outlets", async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: "Authorization header required" })
    }

    const token = authHeader.split(" ")[1]
    const decoded = (jwt as any).verify(token, JWT_SECRET) as { regionId: string }

    const outlets = await prisma.outlet.findMany({
      where: {
        regionId: decoded.regionId
      },
      include: {
        officers: {
          select: {
            id: true,
            name: true,
            status: true,
            counterNumber: true
          }
        },
        _count: {
          select: {
            tokens: {
              where: {
                createdAt: {
                  gte: new Date(new Date().setHours(0, 0, 0, 0))
                }
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    })

    res.json(outlets)
  } catch (error) {
    console.error("Get outlets error:", error)
    res.status(500).json({ error: "Failed to get outlets" })
  }
})

// Create new outlet in manager's region
router.post("/outlets", async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: "Authorization header required" })
    }

    const token = authHeader.split(" ")[1]
    const decoded = (jwt as any).verify(token, JWT_SECRET) as { regionId: string }

    const { name, location, counters } = req.body

    if (!name || !location) {
      return res.status(400).json({ error: "Name and location are required" })
    }

    // Validate counters is a positive number
    const counterCount = counters ? parseInt(counters) : 5
    if (counterCount < 1 || counterCount > 20) {
      return res.status(400).json({ error: "Counter count must be between 1 and 20" })
    }

    const outlet = await prisma.outlet.create({
      data: {
        name: name.trim(),
        location: location.trim(),
        regionId: decoded.regionId,
        counterCount: counterCount,
        isActive: true
      },
      include: {
        officers: true,
        region: {
          select: {
            name: true
          }
        }
      }
    })

    res.status(201).json({
      success: true,
      message: "Outlet created successfully",
      outlet
    })
  } catch (error: any) {
    console.error("Create outlet error:", error)
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Outlet name already exists in this region" })
    } else {
      res.status(500).json({ error: "Failed to create outlet", details: error.message || "Unknown error" })
    }
  }
})

// Update outlet in manager's region
router.put("/outlets/:outletId", async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ error: "Authorization header required" })
    }

    const token = authHeader.split(" ")[1]
    const decoded = (jwt as any).verify(token, JWT_SECRET) as { regionId: string }

    const { outletId } = req.params
    const { name, location, counters, isActive } = req.body

    // Verify outlet belongs to manager's region
    const existingOutlet = await prisma.outlet.findFirst({
      where: {
        id: outletId,
        regionId: decoded.regionId
      }
    })

    if (!existingOutlet) {
      return res.status(404).json({ error: "Outlet not found in your region" })
    }

    // Prepare update data
    const updateData: any = {}
    if (name !== undefined) updateData.name = name.trim()
    if (location !== undefined) updateData.location = location.trim()
    if (counters !== undefined) {
      const counterCount = parseInt(counters)
      if (counterCount < 1 || counterCount > 20) {
        return res.status(400).json({ error: "Counter count must be between 1 and 20" })
      }
      updateData.counterCount = counterCount
    }
    if (isActive !== undefined) updateData.isActive = Boolean(isActive)

    const outlet = await prisma.outlet.update({
      where: { id: outletId },
      data: updateData,
      include: {
        officers: true,
        region: {
          select: {
            name: true
          }
        }
      }
    })

    res.json({
      success: true,
      message: "Outlet updated successfully",
      outlet
    })
  } catch (error: any) {
    console.error("Update outlet error:", error)
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Outlet name already exists in this region" })
    } else if (error.code === 'P2025') {
      res.status(404).json({ error: "Outlet not found" })
    } else {
      res.status(500).json({ error: "Failed to update outlet", details: error.message || "Unknown error" })
    }
  }
})

// Get break analytics for all officers in manager's outlets
router.get("/analytics/breaks/:regionId", async (req, res) => {
  try {
    const { regionId } = req.params
    const { timeframe = 'today' } = req.query

    // Calculate date range based on timeframe
    let startDate = new Date()
    let endDate = new Date()
    
    switch (timeframe) {
      case 'today':
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(23, 59, 59, 999)
        break
      case 'week':
        const dayOfWeek = startDate.getDay()
        startDate.setDate(startDate.getDate() - dayOfWeek)
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(23, 59, 59, 999)
        break
      case 'month':
        startDate.setDate(1)
        startDate.setHours(0, 0, 0, 0)
        endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0)
        endDate.setHours(23, 59, 59, 999)
        break
    }

    // Get all outlets in the region
    const outlets = await prisma.outlet.findMany({
      where: { regionId },
      include: {
        officers: {
          include: {
            BreakLog: {
              where: {
                startedAt: {
                  gte: startDate,
                  lte: endDate
                }
              },
              orderBy: { startedAt: 'desc' }
            }
          }
        }
      }
    })

    // Aggregate break data
    const breakAnalytics = outlets.map(outlet => {
      const officerBreakData = outlet.officers.map(officer => {
        const breaks = officer.BreakLog
        const totalBreaks = breaks.length
        const totalMinutes = breaks.reduce((sum, brk) => {
          if (brk.endedAt) {
            return sum + Math.floor((brk.endedAt.getTime() - brk.startedAt.getTime()) / (1000 * 60))
          }
          return sum + Math.floor((Date.now() - brk.startedAt.getTime()) / (1000 * 60))
        }, 0)
        
        const activeBreak = breaks.find(brk => !brk.endedAt)
        const avgBreakDuration = totalBreaks > 0 ? Math.round(totalMinutes / totalBreaks) : 0

        return {
          officerId: officer.id,
          officerName: officer.name,
          counterNumber: officer.counterNumber,
          status: officer.status,
          totalBreaks,
          totalMinutes,
          avgBreakDuration,
          activeBreak: activeBreak ? {
            id: activeBreak.id,
            startedAt: activeBreak.startedAt,
            durationMinutes: Math.floor((Date.now() - activeBreak.startedAt.getTime()) / (1000 * 60))
          } : null,
          recentBreaks: breaks.slice(0, 3).map(brk => ({
            id: brk.id,
            startedAt: brk.startedAt,
            endedAt: brk.endedAt,
            durationMinutes: brk.endedAt 
              ? Math.floor((brk.endedAt.getTime() - brk.startedAt.getTime()) / (1000 * 60))
              : Math.floor((Date.now() - brk.startedAt.getTime()) / (1000 * 60))
          }))
        }
      })

      return {
        outletId: outlet.id,
        outletName: outlet.name,
        outletLocation: outlet.location,
        officers: officerBreakData
      }
    })

    // Calculate region-wide statistics
    const allOfficers = breakAnalytics.flatMap(outlet => outlet.officers)
    const regionStats = {
      totalOfficers: allOfficers.length,
      officersOnBreak: allOfficers.filter(o => o.activeBreak).length,
      totalBreaksToday: allOfficers.reduce((sum, o) => sum + o.totalBreaks, 0),
      totalBreakMinutes: allOfficers.reduce((sum, o) => sum + o.totalMinutes, 0),
      avgBreakDuration: allOfficers.length > 0 
        ? Math.round(allOfficers.reduce((sum, o) => sum + o.avgBreakDuration, 0) / allOfficers.length)
        : 0
    }

    res.json({
      timeframe,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      regionStats,
      outlets: breakAnalytics
    })
  } catch (error) {
    console.error("Get break analytics error:", error)
    res.status(500).json({ error: "Failed to get break analytics" })
  }
})

// Get detailed break report for a specific officer
router.get("/breaks/officer/:officerId", async (req, res) => {
  try {
    const { officerId } = req.params
    const { startDate, endDate } = req.query

    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
    const end = endDate ? new Date(endDate as string) : new Date()

    const officer = await prisma.officer.findUnique({
      where: { id: officerId },
      include: {
        outlet: true,
        BreakLog: {
          where: {
            startedAt: {
              gte: start,
              lte: end
            }
          },
          orderBy: { startedAt: 'desc' }
        }
      }
    })

    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    const breakData = officer.BreakLog.map(brk => ({
      id: brk.id,
      startedAt: brk.startedAt,
      endedAt: brk.endedAt,
      durationMinutes: brk.endedAt 
        ? Math.floor((brk.endedAt.getTime() - brk.startedAt.getTime()) / (1000 * 60))
        : Math.floor((Date.now() - brk.startedAt.getTime()) / (1000 * 60)),
      isActive: !brk.endedAt
    }))

    const stats = {
      totalBreaks: breakData.length,
      totalMinutes: breakData.reduce((sum, brk) => sum + brk.durationMinutes, 0),
      avgDuration: breakData.length > 0 
        ? Math.round(breakData.reduce((sum, brk) => sum + brk.durationMinutes, 0) / breakData.length)
        : 0,
      longestBreak: breakData.length > 0 ? Math.max(...breakData.map(brk => brk.durationMinutes)) : 0,
      activeBreak: breakData.find(brk => brk.isActive) || null
    }

    res.json({
      officer: {
        id: officer.id,
        name: officer.name,
        counterNumber: officer.counterNumber,
        status: officer.status,
        outlet: officer.outlet
      },
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
      stats,
      breaks: breakData
    })
  } catch (error) {
    console.error("Get officer break report error:", error)
    res.status(500).json({ error: "Failed to get officer break report" })
  }
})

// Force end a break (manager override)
router.post("/breaks/end/:breakId", async (req, res) => {
  try {
    const { breakId } = req.params
    const { reason } = req.body

    const breakLog = await prisma.breakLog.findUnique({
      where: { id: breakId },
      include: { Officer: true }
    })

    if (!breakLog) {
      return res.status(404).json({ error: "Break not found" })
    }

    if (breakLog.endedAt) {
      return res.status(400).json({ error: "Break already ended" })
    }

    // End the break
    const updatedBreak = await prisma.breakLog.update({
      where: { id: breakId },
      data: { endedAt: new Date() }
    })

    // Update officer status to available
    await prisma.officer.update({
      where: { id: breakLog.officerId },
      data: { status: 'available' }
    })

    const durationMinutes = Math.floor(
      (updatedBreak.endedAt!.getTime() - updatedBreak.startedAt.getTime()) / (1000 * 60)
    )

    res.json({ 
      success: true, 
      message: `Break ended by manager${reason ? ': ' + reason : ''}`,
      breakLog: updatedBreak,
      durationMinutes
    })
  } catch (error) {
    console.error("Force end break error:", error)
    res.status(500).json({ error: "Failed to end break" })
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