import { Router } from "express"
import { prisma, broadcast, logger } from "../server"
import * as jwt from "jsonwebtoken"
import { getLastDailyReset } from "../utils/resetWindow"
import sltSmsService from "../services/sltSmsService"
import { getTrackingUrl } from "../utils/urlHelper"

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
    const { 
      name, 
      mobileNumber, 
      serviceTypes, 
      preferredLanguages, 
      nicNumber, 
      email, 
      sltMobileNumber, 
      accountRef, 
      sltTelephoneNumber, 
      sltTelephoneNumbers, // New array field for multiple numbers
      billPaymentIntent, 
      billPaymentAmount, 
      billPaymentMethod 
    } = req.body
    logger.info({ mobileNumber, serviceTypes }, '[KIOSK] Received token generation request')

    const prioritySettingRows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting" WHERE "key" = 'priority_service_enabled' LIMIT 1
    `
    const priorityFeatureEnabled = prioritySettingRows[0]?.booleanValue ?? true

    const priorityServices = await prisma.$queryRaw`
      SELECT id FROM "Service" WHERE "code" = ANY(${serviceTypes}::text[]) AND "isPriorityService" = true LIMIT 1
    ` as any[]
    const autoPriority = priorityFeatureEnabled && priorityServices.length > 0

    // Handle both single and multiple telephone numbers for backward compatibility
    let telephoneNumbersToProcess: string[] = []
    
    if (sltTelephoneNumbers && Array.isArray(sltTelephoneNumbers) && sltTelephoneNumbers.length > 0) {
      telephoneNumbersToProcess = sltTelephoneNumbers
    } else if (sltTelephoneNumber) {
      telephoneNumbersToProcess = [sltTelephoneNumber]
    }

    // Validate telephone numbers if provided
    if (telephoneNumbersToProcess.length > 0) {
      const phoneRegex = /^\d{10}$/
      const invalidNumbers = telephoneNumbersToProcess.filter(num => !phoneRegex.test(num))
      
      if (invalidNumbers.length > 0) {
        return res.status(400).json({
          error: `Invalid telephone numbers. Must be 10 digits: ${invalidNumbers.join(', ')}`
        })
      }

      if (telephoneNumbersToProcess.length > 10) { // Limit to prevent abuse
        return res.status(400).json({
          error: 'Maximum 10 telephone numbers allowed per token.'
        })
      }
    }

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

    // Check OTP requirement from admin setting
    const otpSettingRows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting" WHERE "key" = 'otp_verification_enabled' LIMIT 1
    `
    const otpRequired = otpSettingRows[0]?.booleanValue ?? true

    // Validate required fields (mobileNumber only required when OTP is enabled)
    if (!name || !serviceTypes || !Array.isArray(serviceTypes) || serviceTypes.length === 0) {
      return res.status(400).json({
        error: "Name and at least one service type are required"
      })
    }

    if (otpRequired && !mobileNumber) {
      return res.status(400).json({ error: "Mobile number is required" })
    }

    // Use placeholder mobile when OTP is disabled and no number provided
    const effectiveMobile = mobileNumber || 'N/A'

    // Validate mobile number format only when OTP is enabled (Sri Lankan format)
    if (otpRequired && mobileNumber) {
      const mobileRegex = /^(?:\+94|0)?[0-9]{9,10}$/
      if (!mobileRegex.test(mobileNumber)) {
        return res.status(400).json({
          error: "Invalid mobile number format. Please enter a valid Sri Lankan mobile number."
        })
      }
    }

    // Normalize the mobile number (only when one is provided)
    let normalizedMobile = effectiveMobile
    if (mobileNumber) {
      normalizedMobile = mobileNumber.replace(/\s+/g, '')
      if (normalizedMobile.startsWith('+94')) {
        normalizedMobile = '0' + normalizedMobile.substring(3)
      } else if (normalizedMobile.startsWith('94')) {
        normalizedMobile = '0' + normalizedMobile.substring(2)
      }
    }

    // Always create a new customer record even if mobileNumber repeats
    const customer = await prisma.customer.create({
      data: {
        name: name.trim(),
        mobileNumber: normalizedMobile,
        nicNumber: nicNumber?.trim() || undefined,
        email: email?.trim() || undefined,
        sltMobileNumber: sltMobileNumber?.trim() || undefined
      }
    })

    // Use a database transaction to prevent race conditions
    const token = await prisma.$transaction(async (tx) => {
      // Use an exclusive lock on the Outlet record to serialize concurrent token generation
      await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${outletId} FOR UPDATE`

      // Get next token number for this outlet
      const lastReset = getLastDailyReset()

      const lastToken = await tx.token.findFirst({
        where: {
          outletId: outletId,
          createdAt: { gte: lastReset }
        },
        orderBy: { tokenNumber: 'desc' }
      })

      const tokenNumber = lastToken ? lastToken.tokenNumber + 1 : 1

      // Create the token
      const newToken = await tx.token.create({
        data: {
          tokenNumber,
          customerId: customer.id,
          serviceTypes,
          preferredLanguages,
          accountRef: accountRef?.trim() || null,
          status: "waiting",
          isPriority: autoPriority,
          outletId: outletId,
          sltTelephoneNumber: sltTelephoneNumber?.trim() || null, // Keep for backward compatibility
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

      // Create TokenBill entries for multiple telephone numbers
      if (telephoneNumbersToProcess.length > 0) {
        for (const phoneNumber of telephoneNumbersToProcess) {
          await tx.tokenBill.create({
            data: {
              tokenId: newToken.id,
              telephoneNumber: phoneNumber,
              billPaymentIntent: billPaymentIntent || null,
              billPaymentAmount: billPaymentIntent === 'partial' ? billPaymentAmount : null,
            }
          })
        }
      }

      return newToken
    }, {
      timeout: 15000, // Increased timeout for multiple telephone number processing
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
        createdAt: token.createdAt,
        telephoneNumbers: telephoneNumbersToProcess // Include the telephone numbers in response
      }
    }

    logger.info({ tokenId: token.id, tokenNumber: token.tokenNumber }, '[KIOSK] Sending token response')
    logger.info({ mobileNumber: token.customer.mobileNumber }, `[KIOSK] Triggering SMS flow`)
    res.status(201).json(response)

    // Send token confirmation SMS off the request path
    void (async () => {
      try {
        const lastReset = getLastDailyReset()
        const queuePosition = await prisma.token.count({
          where: {
            outletId: token.outletId,
            status: "waiting",
            tokenNumber: { lt: token.tokenNumber },
            createdAt: { gte: lastReset },
          },
        }) + 1

        const estimatedWait = Math.max(1, queuePosition * 5)

        const trackingUrl = getTrackingUrl(token.id)

        // Detect language precisely like online registration
        const lang = Array.isArray(preferredLanguages) && preferredLanguages.length > 0
          ? preferredLanguages[0]
          : preferredLanguages || 'en'

        console.log(`[KIOSK] Preparing SMS for ${token.customer.mobileNumber}. Pos: ${queuePosition}, Lang: ${lang}, URL: ${trackingUrl}`)

        // Use sltSmsService directly but with better error reporting
        const result = await sltSmsService.sendTokenConfirmation(token.customer.mobileNumber, {
          tokenNumber: token.tokenNumber,
          queuePosition,
          outletName: token.outlet?.name || 'SLT Office',
          trackingUrl,
          estimatedWait,
        }, lang as any)

        if (result.success) {
          logger.info({ mobileNumber: token.customer.mobileNumber, messageId: result.messageId }, `✓ Kiosk token confirmation SMS sent`)
        } else {
          logger.warn({ mobileNumber: token.customer.mobileNumber, error: result.error }, `✗ Kiosk token confirmation SMS failed`)
        }
      } catch (smsError: any) {
        logger.error({ error: smsError.message }, 'Kiosk token confirmation SMS error')
      }
    })()
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
