import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined

// Teleshop Manager authentication using mobile number
router.post("/login", async (req, res) => {
  try {
    const { mobileNumber } = req.body

    if (!mobileNumber) {
      return res.status(400).json({ error: "Mobile number is required" })
    }

    // Find teleshop manager by mobile number
    const teleshopManager = await prisma.teleshopManager.findUnique({
      where: {
        mobileNumber: mobileNumber,
        isActive: true
      },
      include: {
        region: true,
        officers: {
          include: {
            outlet: true
          }
        }
      }
    })

    if (!teleshopManager) {
      return res.status(401).json({ error: "Teleshop Manager not found or inactive" })
    }

    // Update last login
    await prisma.teleshopManager.update({
      where: { id: teleshopManager.id },
      data: { lastLoginAt: new Date() }
    })

    // Create JWT token for teleshop manager authentication
    const tokenOptions: any = { 
      teleshopManagerId: teleshopManager.id,
      name: teleshopManager.name,
      mobileNumber: teleshopManager.mobileNumber,
      regionId: teleshopManager.regionId,
      role: "teleshop_manager"
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

    // Set httpOnly cookie
    res.cookie("dq_teleshop_manager_jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    })

    res.json({
      success: true,
      teleshopManager: {
        id: teleshopManager.id,
        name: teleshopManager.name,
        mobileNumber: teleshopManager.mobileNumber,
        regionId: teleshopManager.regionId,
        regionName: teleshopManager.region.name,
        officers: teleshopManager.officers
      },
      token,
      message: "Login successful"
    })
  } catch (error) {
    console.error("Teleshop Manager login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Teleshop Manager logout
router.post("/logout", async (req, res) => {
  try {
    res.clearCookie("dq_teleshop_manager_jwt", {
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
    console.error("Teleshop Manager logout error:", error)
    res.status(500).json({ error: "Logout failed" })
  }
})

// Middleware to authenticate teleshop manager
const authenticateTeleshopManager = async (req: any, res: any, next: any) => {
  try {
    let token = req.cookies?.dq_teleshop_manager_jwt
    
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }

    if (!token) {
      return res.status(401).json({ error: "Teleshop Manager authentication required" })
    }

    const payload = (jwt as any).verify(token, JWT_SECRET)
    
    if (payload.role !== "teleshop_manager") {
      return res.status(403).json({ error: "Access denied. Teleshop Manager role required." })
    }

    // Verify teleshop manager still exists and is active
    const teleshopManager = await prisma.teleshopManager.findUnique({
      where: { 
        id: payload.teleshopManagerId,
        isActive: true 
      },
      include: { region: true }
    })

    if (!teleshopManager) {
      return res.status(401).json({ error: "Teleshop Manager not found or inactive" })
    }

    req.teleshopManager = teleshopManager
    next()
  } catch (error) {
    console.error("Teleshop Manager authentication error:", error)
    res.status(401).json({ error: "Invalid token" })
  }
}

// Apply authentication middleware to protected routes
router.use(authenticateTeleshopManager)

// Get teleshop manager profile
router.get("/me", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    const profile = await prisma.teleshopManager.findUnique({
      where: { id: teleshopManager.id },
      include: {
        region: true,
        officers: {
          include: {
            outlet: true,
            BreakLog: {
              where: {
                endedAt: null // Active breaks only
              },
              orderBy: { startedAt: 'desc' },
              take: 1
            }
          }
        }
      }
    })

    res.json({ teleshopManager: profile })
  } catch (error) {
    console.error("Teleshop Manager profile fetch error:", error)
    res.status(500).json({ error: "Failed to fetch profile" })
  }
})

// Get officers managed by teleshop manager
router.get("/officers", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    const officers = await prisma.officer.findMany({
      where: {
        teleshopManagerId: teleshopManager.id
      },
      include: {
        outlet: true,
        BreakLog: {
          orderBy: { startedAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Process officers data to include break statistics and current status
    const processedOfficers = officers.map(officer => {
      const todaysBreaks = officer.BreakLog.filter(breakLog => {
        const breakDate = new Date(breakLog.startedAt)
        const today = new Date()
        return breakDate.toDateString() === today.toDateString()
      })

      const activeBreak = officer.BreakLog.find(breakLog => !breakLog.endedAt)
      
      // Calculate total break time (in minutes)
      const totalMinutes = officer.BreakLog.reduce((total, breakLog) => {
        if (breakLog.endedAt) {
          const duration = new Date(breakLog.endedAt).getTime() - new Date(breakLog.startedAt).getTime()
          return total + Math.floor(duration / (1000 * 60))
        }
        return total
      }, 0)

      // Determine status
      let status = 'offline' // default
      if (activeBreak) {
        status = 'break'
      } else {
        // You might want to implement online/offline logic based on last activity
        // For now, we'll use a simple check
        status = 'offline' // This should be determined by actual online status logic
      }

      return {
        id: officer.id,
        name: officer.name,
        mobileNumber: officer.mobileNumber,
        counterNumber: officer.counterNumber,
        status,
        outlet: officer.outlet,
        totalBreaks: officer.BreakLog.length,
        totalMinutes,
        activeBreak: activeBreak ? {
          id: activeBreak.id,
          startTime: activeBreak.startedAt
        } : null,
        createdAt: officer.createdAt
      }
    })

    res.json({ success: true, officers: processedOfficers, endpoint: "teleshop-manager-officers-v2" })
  } catch (error) {
    console.error("Teleshop Manager officers fetch error:", error)
    res.status(500).json({ error: "Failed to fetch officers" })
  }
})

// Add new officer under teleshop manager
router.post("/officers", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { name, mobileNumber, outletId, counterNumber, isTraining, languages, assignedServices } = req.body

    if (!name || !mobileNumber || !outletId) {
      return res.status(400).json({ error: "Name, mobile number, and outlet ID are required" })
    }

    // Verify the outlet is in the teleshop manager's region
    const outlet = await prisma.outlet.findFirst({
      where: {
        id: outletId,
        regionId: teleshopManager.regionId
      }
    })

    if (!outlet) {
      return res.status(403).json({ error: "Outlet not found in your region" })
    }

    // Create the officer
    const officerData: any = {
      name,
      mobileNumber,
      outletId,
      teleshopManagerId: teleshopManager.id
    }

    if (counterNumber !== undefined) {
      officerData.counterNumber = counterNumber
    }

    if (isTraining !== undefined) {
      officerData.isTraining = isTraining
    }

    if (Array.isArray(assignedServices) && assignedServices.length > 0) {
      officerData.assignedServices = assignedServices
    }

    if (Array.isArray(languages) && languages.length > 0) {
      officerData.languages = languages
    }

    console.log("Creating officer with data:", JSON.stringify(officerData, null, 2))
    
    const officer = await prisma.officer.create({
      data: officerData,
      include: {
        outlet: true,
        teleshopManager: true
      }
    })

    res.json({ success: true, officer })
  } catch (error: any) {
    console.error("Teleshop Manager officer creation error:", error)
    console.error("Request body:", req.body)
    
    if (error.code === 'P2002') {
      res.status(400).json({ error: "An officer with this mobile number already exists" })
    } else if (error.code === 'P2003') {
      res.status(400).json({ error: "Invalid outlet ID" })
    } else {
      res.status(500).json({ error: "Failed to create officer", details: error.message || "Unknown error" })
    }
  }
})

// Update officer managed by teleshop manager
router.patch("/officers/:officerId", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { officerId } = req.params
    const { name, counterNumber, assignedServices, isTraining, languages } = req.body

    // Verify officer belongs to this teleshop manager
    const existingOfficer = await prisma.officer.findFirst({
      where: {
        id: officerId,
        teleshopManagerId: teleshopManager.id
      }
    })

    if (!existingOfficer) {
      return res.status(403).json({ error: "Officer not found or not under your management" })
    }

    // Prepare update data
    const updateData: any = {}
    
    if (name !== undefined) updateData.name = name
    if (counterNumber !== undefined) updateData.counterNumber = counterNumber
    if (isTraining !== undefined) updateData.isTraining = isTraining
    if (assignedServices !== undefined) updateData.assignedServices = assignedServices
    if (languages !== undefined) updateData.languages = languages

    console.log("Updating officer with data:", JSON.stringify(updateData, null, 2))
    
    const updatedOfficer = await prisma.officer.update({
      where: { id: officerId },
      data: updateData,
      include: {
        outlet: true,
        teleshopManager: true
      }
    })

    res.json({ success: true, officer: updatedOfficer })
  } catch (error: any) {
    console.error("Teleshop Manager officer update error:", error)
    
    if (error.code === 'P2002') {
      res.status(400).json({ error: "An officer with this mobile number already exists" })
    } else if (error.code === 'P2025') {
      res.status(404).json({ error: "Officer not found" })
    } else {
      res.status(500).json({ error: "Failed to update officer", details: error.message || "Unknown error" })
    }
  }
})

// Delete officer managed by teleshop manager
router.delete("/officers/:officerId", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { officerId } = req.params

    // Verify officer belongs to this teleshop manager
    const existingOfficer = await prisma.officer.findFirst({
      where: {
        id: officerId,
        teleshopManagerId: teleshopManager.id
      }
    })

    if (!existingOfficer) {
      return res.status(404).json({ error: "Officer not found or not under your management" })
    }

    // Delete the officer
    await prisma.officer.delete({
      where: { id: officerId }
    })

    res.json({ success: true, message: "Officer deleted successfully" })
  } catch (error: any) {
    console.error("Teleshop Manager officer deletion error:", error)
    
    if (error.code === 'P2025') {
      res.status(404).json({ error: "Officer not found" })
    } else {
      res.status(500).json({ error: "Failed to delete officer", details: error.message || "Unknown error" })
    }
  }
})

// Get break analytics for officers under teleshop manager
router.get("/breaks/analytics", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
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

    // Get all officers under this teleshop manager with break data
    const officers = await prisma.officer.findMany({
      where: {
        teleshopManagerId: teleshopManager.id
      },
      include: {
        outlet: true,
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
    })

    // Process break analytics for each officer
    const breakAnalytics = officers.map(officer => {
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
        mobileNumber: officer.mobileNumber,
        counterNumber: officer.counterNumber,
        status: officer.status,
        outlet: {
          id: officer.outlet.id,
          name: officer.outlet.name,
          location: officer.outlet.location
        },
        totalBreaks,
        totalMinutes,
        avgBreakDuration,
        activeBreak: activeBreak ? {
          id: activeBreak.id,
          startedAt: activeBreak.startedAt,
          durationMinutes: Math.floor((Date.now() - activeBreak.startedAt.getTime()) / (1000 * 60))
        } : null,
        recentBreaks: breaks.slice(0, 5).map(brk => ({
          id: brk.id,
          startedAt: brk.startedAt,
          endedAt: brk.endedAt,
          durationMinutes: brk.endedAt 
            ? Math.floor((brk.endedAt.getTime() - brk.startedAt.getTime()) / (1000 * 60))
            : Math.floor((Date.now() - brk.startedAt.getTime()) / (1000 * 60))
        }))
      }
    })

    // Calculate teleshop manager statistics
    const teleshopStats = {
      totalOfficers: officers.length,
      officersOnBreak: breakAnalytics.filter(o => o.activeBreak).length,
      totalBreaksToday: breakAnalytics.reduce((sum, o) => sum + o.totalBreaks, 0),
      totalBreakMinutes: breakAnalytics.reduce((sum, o) => sum + o.totalMinutes, 0),
      avgBreakDuration: breakAnalytics.length > 0 
        ? Math.round(breakAnalytics.reduce((sum, o) => sum + o.avgBreakDuration, 0) / breakAnalytics.length)
        : 0
    }

    res.json({
      timeframe,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      teleshopStats,
      officers: breakAnalytics
    })
  } catch (error) {
    console.error("Get teleshop manager break analytics error:", error)
    res.status(500).json({ error: "Failed to get break analytics" })
  }
})

// Get detailed break report for a specific officer
router.get("/breaks/officer/:officerId", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { officerId } = req.params
    const { startDate, endDate } = req.query

    // Verify officer belongs to this teleshop manager
    const officer = await prisma.officer.findFirst({
      where: {
        id: officerId,
        teleshopManagerId: teleshopManager.id
      },
      include: {
        outlet: true
      }
    })

    if (!officer) {
      return res.status(403).json({ error: "Officer not found or not under your management" })
    }

    const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
    const end = endDate ? new Date(endDate as string) : new Date()

    const breakLogs = await prisma.breakLog.findMany({
      where: {
        officerId: officerId,
        startedAt: {
          gte: start,
          lte: end
        }
      },
      orderBy: { startedAt: 'desc' }
    })

    const breakData = breakLogs.map(brk => ({
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
        mobileNumber: officer.mobileNumber,
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

// Get available outlets in teleshop manager's region
router.get("/outlets", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    const outlets = await prisma.outlet.findMany({
      where: {
        regionId: teleshopManager.regionId,
        isActive: true
      },
      include: {
        officers: {
          select: {
            id: true,
            name: true,
            status: true,
            counterNumber: true,
            teleshopManagerId: true
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

// Get completed services for teleshop manager's officers
router.get("/completed-services", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { 
      page = "1", 
      limit = "20", 
      startDate, 
      endDate, 
      officerId,
      outletId 
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = {
      teleshopManagerId: teleshopManager.id
    }

    if (officerId) {
      where.officerId = officerId
    }

    if (outletId) {
      where.outletId = outletId
    }

    if (startDate || endDate) {
      where.completedAt = {}
      if (startDate) where.completedAt.gte = new Date(startDate as string)
      if (endDate) where.completedAt.lte = new Date(endDate as string)
    }

    // Get completed services
    const [completedServices, totalCount] = await Promise.all([
      (prisma as any).completedService.findMany({
        where,
        include: {
          token: {
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  mobileNumber: true
                }
              }
            }
          },
          service: {
            select: {
              id: true,
              code: true,
              title: true
            }
          },
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
        },
        orderBy: {
          completedAt: 'desc'
        },
        skip,
        take: limitNum
      }),
      (prisma as any).completedService.count({ where })
    ])

    // Calculate statistics
    const stats = {
      totalServices: totalCount,
      todayServices: await (prisma as any).completedService.count({
        where: {
          ...where,
          completedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      thisWeekServices: await (prisma as any).completedService.count({
        where: {
          ...where,
          completedAt: {
            gte: new Date(new Date().setDate(new Date().getDate() - 7))
          }
        }
      }),
      avgDuration: await (prisma as any).completedService.aggregate({
        where: {
          ...where,
          duration: { not: null }
        },
        _avg: {
          duration: true
        }
      }).then((result: any) => Math.round(result._avg.duration || 0))
    }

    res.json({
      services: completedServices,
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
    console.error("Get completed services error:", error)
    res.status(500).json({ error: "Failed to get completed services" })
  }
})

// Get feedback assigned to teleshop manager (3-star ratings)
router.get("/feedback", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { 
      page = "1", 
      limit = "20", 
      resolved = "false",
      startDate,
      endDate 
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause for feedback assigned to teleshop manager
    const where: any = {
      rating: 3, // 3-star ratings go to teleshop manager
      assignedTo: "teleshop_manager",
      assignedToId: teleshopManager.id
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
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: limitNum
      }),
      prisma.feedback.count({ where })
    ])

    // Calculate statistics
    const stats = {
      totalFeedback: totalCount,
      unresolvedFeedback: await prisma.feedback.count({
        where: {
          ...where,
          isResolved: false
        }
      }),
      resolvedFeedback: await prisma.feedback.count({
        where: {
          ...where,
          isResolved: true
        }
      }),
      todayFeedback: await prisma.feedback.count({
        where: {
          ...where,
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
    console.error("Get feedback error:", error)
    res.status(500).json({ error: "Failed to get feedback" })
  }
})

// Resolve feedback (mark as resolved with resolution comment)
router.patch("/feedback/:feedbackId/resolve", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { feedbackId } = req.params
    const { resolutionComment } = req.body

    // Verify feedback belongs to this teleshop manager
    const existingFeedback = await prisma.feedback.findFirst({
      where: {
        id: feedbackId,
        assignedTo: "teleshop_manager",
        assignedToId: teleshopManager.id,
        rating: 3
      }
    })

    if (!existingFeedback) {
      return res.status(403).json({ error: "Feedback not found or not assigned to you" })
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
        resolvedBy: `${teleshopManager.name} (Teleshop Manager)`,
        resolutionComment: resolutionComment || "Resolved by teleshop manager"
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
    console.error("Resolve feedback error:", error)
    res.status(500).json({ error: "Failed to resolve feedback" })
  }
})

export default router

// Service case updates (Teleshop Manager)
router.post('/service-case/update', async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    const { refNumber, note, status } = req.body || {}
    if (!refNumber || !note) return res.status(400).json({ error: 'refNumber and note are required' })

    const sc: any = await (prisma as any).serviceCase.findUnique({ where: { refNumber } })
    if (!sc) return res.status(404).json({ error: 'Reference not found' })

    const upd = await (prisma as any).serviceCaseUpdate.create({
      data: {
        caseId: sc.id,
        actorRole: 'teleshop_manager',
        actorId: tm.id,
        status: status || null,
        note,
      }
    })

    await (prisma as any).serviceCase.update({ where: { id: sc.id }, data: { lastUpdatedAt: new Date() } })

    res.json({ success: true, update: upd })
  } catch (e) {
    console.error('Teleshop manager service-case update error:', e)
    res.status(500).json({ error: 'Failed to add update' })
  }
})

router.post('/service-case/complete', async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    const { refNumber, note } = req.body || {}
    if (!refNumber) return res.status(400).json({ error: 'refNumber is required' })

    const sc: any = await (prisma as any).serviceCase.findUnique({ where: { refNumber } })
    if (!sc) return res.status(404).json({ error: 'Reference not found' })

    const updated = await (prisma as any).serviceCase.update({
      where: { id: sc.id },
      data: { status: 'completed', completedAt: new Date(), lastUpdatedAt: new Date() }
    })

    await (prisma as any).serviceCaseUpdate.create({
      data: {
        caseId: sc.id,
        actorRole: 'teleshop_manager',
        actorId: tm.id,
        status: 'completed',
        note: note || 'Marked completed',
      }
    })

    res.json({ success: true, case: updated })
  } catch (e) {
    console.error('Teleshop manager service-case complete error:', e)
    res.status(500).json({ error: 'Failed to complete case' })
  }
})