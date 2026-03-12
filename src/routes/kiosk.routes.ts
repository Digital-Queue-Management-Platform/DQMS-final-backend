import { Router } from "express"
import { prisma, broadcast } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const JWT_EXPIRES = "24h" // Kiosk sessions expire after 24 hours

// Kiosk authentication middleware
const authenticateKiosk = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Access denied. No token provided." })
    }

    const token = authHeader.substring(7)
    const decoded = (jwt as any).verify(token, JWT_SECRET as jwt.Secret)

    if (decoded.type !== 'kiosk') {
      return res.status(403).json({ error: "Access denied. Kiosk token required." })
    }

    // Verify outlet still exists and is active
    const outlet = await prisma.outlet.findUnique({
      where: { id: decoded.outletId },
      select: { isActive: true }
    })

    if (!outlet || !outlet.isActive) {
      return res.status(403).json({ error: "Outlet is no longer active." })
    }

    req.kiosk = decoded
    next()
  } catch (error) {
    res.status(401).json({ error: "Invalid token." })
  }
}

// Kiosk login endpoint
router.post("/login", async (req, res) => {
  try {
    const { outletId, password } = req.body

    if (!outletId || !password) {
      return res.status(400).json({ error: "Outlet ID and password are required" })
    }

    // Find outlet and verify password
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      include: {
        region: {
          select: {
            name: true
          }
        }
      }
    }) as any

    if (!outlet) {
      return res.status(401).json({ error: "Invalid outlet ID or password" })
    }

    if (!outlet.isActive) {
      return res.status(403).json({ error: "This outlet is not active" })
    }

    // Simple password comparison (not hashed for easier management)
    if (outlet.kioskPassword !== password) {
      return res.status(401).json({ error: "Invalid outlet ID or password" })
    }

    // Generate JWT token
    const token = (jwt as any).sign(
      {
        outletId: outlet.id,
        outletName: outlet.name,
        regionName: outlet.region.name,
        type: "kiosk"
      },
      JWT_SECRET as jwt.Secret,
      { expiresIn: JWT_EXPIRES }
    )

    res.json({
      token,
      outlet: {
        id: outlet.id,
        name: outlet.name,
        location: outlet.location,
        regionName: outlet.region.name
      }
    })
  } catch (error) {
    console.error("Kiosk login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Apply authentication middleware to protected routes
router.use(authenticateKiosk)

// Get available services
router.get("/services", async (req, res) => {
  try {
    // Use raw query to avoid Prisma client issues before regeneration
    const services = await prisma.$queryRaw`
      SELECT "id", "code", "title", "description", "order", "isPriorityService"
      FROM "Service" 
      WHERE "isActive" = true 
      ORDER BY "order" ASC, "createdAt" ASC
    `
    res.json(services)
  } catch (error) {
    console.error("Fetch services error:", error)
    res.status(500).json({ error: "Failed to fetch services" })
  }
})

// Create walk-in token
router.post("/tokens", async (req: any, res: any) => {
  try {
    const { outletId } = req.kiosk
    const { name, mobileNumber, serviceTypes, preferredLanguages, nicNumber, email, sltMobileNumber, accountRef, sltTelephoneNumber, billPaymentIntent, billPaymentAmount, billPaymentMethod } = req.body

    const prioritySettingRows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting" WHERE "key" = 'priority_service_enabled' LIMIT 1
    `
    const priorityFeatureEnabled = prioritySettingRows[0]?.booleanValue ?? true

    const priorityServices = await prisma.$queryRaw`
      SELECT id FROM "Service" WHERE "code" = ANY(${serviceTypes}::text[]) AND "isPriorityService" = true LIMIT 1
    ` as any[]
    const autoPriority = priorityFeatureEnabled && priorityServices.length > 0

    // Validate bill payment intent if provided
    if (billPaymentIntent && !['full', 'partial'].includes(billPaymentIntent)) {
      return res.status(400).json({ error: "billPaymentIntent must be 'full' or 'partial'" })
    }
    if (billPaymentIntent === 'partial' && (typeof billPaymentAmount !== 'number' || billPaymentAmount <= 0)) {
      return res.status(400).json({ error: "billPaymentAmount must be a positive number for partial payments" })
    }
    if (billPaymentMethod && !['cash', 'card', 'cheque', 'bank_transfer'].includes(billPaymentMethod)) {
      return res.status(400).json({ error: "billPaymentMethod must be 'cash', 'card', 'cheque', or 'bank_transfer'" })
    }

    // Validate required fields
    if (!name || !mobileNumber || !serviceTypes || !Array.isArray(serviceTypes) || serviceTypes.length === 0) {
      return res.status(400).json({
        error: "Name, mobile number, and at least one service type are required"
      })
    }

    // Validate mobile number format (Sri Lankan format)
    const mobileRegex = /^(?:\+94|0)?[0-9]{9,10}$/
    if (!mobileRegex.test(mobileNumber)) {
      return res.status(400).json({
        error: "Invalid mobile number format. Please enter a valid Sri Lankan mobile number."
      })
    }

    // Normalize the mobile number
    let normalizedMobile = mobileNumber.replace(/\s+/g, '')
    if (normalizedMobile.startsWith('+94')) {
      normalizedMobile = '0' + normalizedMobile.substring(3)
    } else if (normalizedMobile.startsWith('94')) {
      normalizedMobile = '0' + normalizedMobile.substring(2)
    }

    // Check or create customer
    let customer = await prisma.customer.findFirst({
      where: { mobileNumber: normalizedMobile }
    })

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: name.trim(),
          mobileNumber: normalizedMobile,
          nicNumber: nicNumber?.trim() || null,
          email: email?.trim() || null,
          sltMobileNumber: sltMobileNumber?.trim() || null
        }
      })
    } else {
      // Update customer info if provided
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          name: name.trim(),
          nicNumber: nicNumber?.trim() || customer.nicNumber,
          email: email?.trim() || customer.email,
          sltMobileNumber: sltMobileNumber?.trim() || customer.sltMobileNumber
        }
      })
    }

    // Get next token number for this outlet
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const lastToken = await prisma.token.findFirst({
      where: {
        outletId: outletId,
        createdAt: { gte: today }
      },
      orderBy: { tokenNumber: 'desc' }
    })

    const tokenNumber = lastToken ? lastToken.tokenNumber + 1 : 1

    // Create the token
    const token = await prisma.token.create({
      data: {
        tokenNumber,
        customerId: customer.id,
        serviceTypes,
        preferredLanguages,
        accountRef: accountRef?.trim() || null,
        status: "waiting",
        isPriority: autoPriority,
        outletId: outletId,
        sltTelephoneNumber: sltTelephoneNumber?.trim() || null,
        billPaymentIntent: billPaymentIntent || null,
        billPaymentAmount: billPaymentIntent === 'partial' ? billPaymentAmount : null,
        billPaymentMethod: billPaymentMethod || null,
      },
      include: {
        customer: {
          select: {
            name: true,
            mobileNumber: true
          }
        },
        outlet: {
          select: {
            name: true,
            location: true
          }
        }
      }
    })

    // Broadcast new token to officers queue system
    broadcast({ type: 'NEW_TOKEN', data: token })

    const response = {
      success: true,
      message: "Token created successfully",
      token: {
        id: token.id,
        tokenNumber: token.tokenNumber,
        customerName: token.customer.name,
        outletName: token.outlet.name,
        serviceTypes: token.serviceTypes,
        status: token.status,
        createdAt: token.createdAt
      }
    }

    console.log('Sending token response:', response)
    res.status(201).json(response)
  } catch (error) {
    console.error("Create walk-in token error:", error)
    res.status(500).json({ error: "Failed to create token" })
  }
})

// Get current queue status
router.get("/queue-status", async (req: any, res: any) => {
  try {
    const { outletId } = req.kiosk

    const waitingCount = await prisma.token.count({
      where: {
        outletId,
        status: "waiting",
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    })

    const servingCount = await prisma.token.count({
      where: {
        outletId,
        status: "serving",
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    })

    // Calculate average waiting time
    const recentCompleted = await prisma.token.findMany({
      where: {
        outletId,
        status: "completed",
        completedAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
        }
      },
      select: {
        createdAt: true,
        startedAt: true
      },
      take: 10
    })

    let avgWaitTime = 0
    if (recentCompleted.length > 0) {
      const totalWait = recentCompleted.reduce((sum, token) => {
        if (token.startedAt) {
          return sum + (token.startedAt.getTime() - token.createdAt.getTime())
        }
        return sum
      }, 0)
      avgWaitTime = Math.round(totalWait / recentCompleted.length / 1000 / 60) // in minutes
    }

    res.json({
      waitingCount,
      servingCount,
      avgWaitTime,
      estimatedWait: avgWaitTime * (waitingCount + 1) // Rough estimate
    })
  } catch (error) {
    console.error("Queue status error:", error)
    res.status(500).json({ error: "Failed to fetch queue status" })
  }
})

export default router
