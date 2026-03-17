import { Router } from "express"
import { prisma, broadcast } from "../server"
import { getLastDailyReset } from "../utils/resetWindow"
import * as jwt from "jsonwebtoken"
import smsHelper from "../utils/smsHelper"
import sltSmsService from "../services/sltSmsService"

const router = Router()

const QR_JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const QR_JWT_EXPIRES = process.env.QR_JWT_EXPIRES || "5m" // short-lived token

// OTP verification config
const OTP_JWT_SECRET = process.env.OTP_JWT_SECRET || "otp-dev-secret"
const OTP_JWT_EXPIRES = process.env.OTP_JWT_EXPIRES || "10m"

// In-memory OTP store (mobile -> record)
type OtpRecord = {
  code: string
  expiresAt: number
  attempts: number
  lastSentAt: number
}
const otpStore = new Map<string, OtpRecord>()

const now = () => Date.now()
const genOtp = () => Math.floor(1000 + Math.random() * 9000).toString()
const FIVE_MIN = 1 * 60 * 1000
const RESEND_WINDOW = 30 * 1000

function normalizeLang(input: unknown): 'en' | 'si' | 'ta' {
  if (typeof input !== 'string') return 'en'
  const v = input.trim().toLowerCase()

  if (['si', 'sinhala', 'sin', 'සිංහල', 'sinh'].includes(v)) return 'si'
  if (['ta', 'tamil', 'tam', 'தமிழ்'].includes(v)) return 'ta'
  return 'en'
}

function toE164(mobile: string): string {
  // Relaxed validation: Just normalize to 10 digits if starting with 0, or keep as is.
  const cleaned = (mobile || "").replace(/\D/g, "")
  if (!cleaned) return mobile
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    return "+94" + cleaned.substring(1)
  }
  // Allow other formats as provided by customer
  if (cleaned.startsWith("94") && cleaned.length === 11) {
    return "+" + cleaned
  }
  return mobile.startsWith("+") ? mobile : "+" + cleaned
}

// Enhanced OTP for customer registration with recovery URL
router.post("/registration/otp/start", async (req, res) => {
  try {
    const { mobileNumber, customerName, outletId, preferredLanguage } = req.body || {}
    if (!mobileNumber) return res.status(400).json({ error: "mobileNumber is required" })

    const OTP_DEV_MODE = process.env.OTP_DEV_MODE === "true"
    const OTP_DEV_ECHO = process.env.OTP_DEV_ECHO === "true"

    // Get outlet name for personalized message
    let outletName = 'SLT Office'
    if (outletId) {
      try {
        const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
        if (outlet) {
          outletName = outlet.name
        }
      } catch (err) {
        console.log('Could not fetch outlet name:', err)
      }
    }

    const key = mobileNumber
    const existing = otpStore.get(key)
    if (existing && now() - existing.lastSentAt < RESEND_WINDOW) {
      const wait = Math.ceil((RESEND_WINDOW - (now() - existing.lastSentAt)) / 1000)
      return res.status(429).json({ error: `Please wait ${wait}s before requesting another OTP` })
    }

    const code = genOtp()
    const record: OtpRecord = {
      code,
      expiresAt: now() + FIVE_MIN,
      attempts: 0,
      lastSentAt: now(),
    }
    otpStore.set(key, record)

    // Localize OTP message by language; fallback to English
    const lang = normalizeLang(preferredLanguage)

    // DEV mode takes precedence
    if (OTP_DEV_MODE) {
      console.log(`[OTP-DEV] Registration OTP for ${mobileNumber}: ${code}`)
      return res.json({ success: true, message: "OTP sent (dev mode)", ...(OTP_DEV_ECHO ? { devCode: code } : {}) })
    }

    // Build recovery URL
    const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
    
    // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
    const sltUrl = origins.find(o => o.includes('slt.lk'))
    const vercelUrl = origins.find(o => o.includes('vercel.app'))
    const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
    
    let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''

    const shortOutlet = outletId ? outletId.substring(0, 8) : 'default'
    const recoveryUrl = baseUrl ? `${baseUrl}/r?o=${shortOutlet}&m=${encodeURIComponent(mobileNumber)}` : `/r?o=${shortOutlet}&m=${encodeURIComponent(mobileNumber)}`

    // Send enhanced OTP SMS with recovery URL
    try {
      const firstName = customerName ? customerName.split(' ')[0] : undefined

      await sltSmsService.sendCustomerRegistrationOTP(mobileNumber, {
        firstName,
        otpCode: code,
        outletName,
        recoveryUrl
      }, lang)

      console.log(`[OTP] Registration OTP sent to ${mobileNumber}`)
      return res.json({ success: true, message: "Registration OTP sent" })
    } catch (smsError: any) {
      console.error('[OTP] Failed to send registration SMS:', smsError)

      // Fallback to basic SMS helper
      try {
        const result = await smsHelper.sendOTP(mobileNumber, code, lang)

        if (result.success) {
          console.log(`[OTP] Fallback: Sent via ${result.provider} to ${mobileNumber}`)
          return res.json({ success: true, message: "OTP sent" })
        } else {
          console.error('[OTP] Fallback also failed:', result.error)
          return res.status(500).json({
            error: result.error || "Failed to send OTP",
            ...(process.env.NODE_ENV !== 'production' ? { provider: result.provider } : {})
          })
        }
      } catch (fallbackError: any) {
        console.error("[OTP][FALLBACK_ERROR]", fallbackError?.message)
        return res.status(500).json({
          error: "Failed to send OTP via SMS",
          ...(process.env.NODE_ENV !== 'production' ? { details: fallbackError?.message } : {})
        })
      }
    }
  } catch (error: any) {
    console.error("[REGISTRATION-OTP][UNCAUGHT]", error?.message)
    return res.status(500).json({
      error: "Failed to send registration OTP",
      ...(process.env.NODE_ENV !== 'production' ? { uncaught: error?.message } : {})
    })
  }
})

// Start OTP: send code to mobile (legacy endpoint)
router.post("/otp/start", async (req, res) => {
  try {
    const { mobileNumber, preferredLanguage } = req.body || {}
    if (!mobileNumber) return res.status(400).json({ error: "mobileNumber is required" })

    const OTP_DEV_MODE = process.env.OTP_DEV_MODE === "true"
    const OTP_DEV_ECHO = process.env.OTP_DEV_ECHO === "true"

    const key = mobileNumber
    const existing = otpStore.get(key)
    if (existing && now() - existing.lastSentAt < RESEND_WINDOW) {
      const wait = Math.ceil((RESEND_WINDOW - (now() - existing.lastSentAt)) / 1000)
      return res.status(429).json({ error: `Please wait ${wait}s before requesting another OTP` })
    }

    const code = genOtp()
    const record: OtpRecord = {
      code,
      expiresAt: now() + FIVE_MIN,
      attempts: 0,
      lastSentAt: now(),
    }
    otpStore.set(key, record)

    // Localize OTP message by language; fallback to English
    const lang = normalizeLang(preferredLanguage)

    // DEV mode takes precedence
    if (OTP_DEV_MODE) {
      console.log(`[OTP-DEV] OTP for ${mobileNumber}: ${code}`)
      return res.json({ success: true, message: "OTP sent (dev mode)", ...(OTP_DEV_ECHO ? { devCode: code } : {}) })
    }

    // Use unified SMS helper that supports both Twilio and SLT SMS
    try {
      const result = await smsHelper.sendOTP(mobileNumber, code, lang)

      if (result.success) {
        console.log(`[OTP] Sent via ${result.provider} to ${mobileNumber}`)
        return res.json({ success: true, message: "OTP sent" })
      } else {
        console.error('[OTP] Failed to send:', result.error)
        return res.status(500).json({
          error: result.error || "Failed to send OTP",
          ...(process.env.NODE_ENV !== 'production' ? { provider: result.provider } : {})
        })
      }
    } catch (smsError: any) {
      console.error("[OTP][SMS_ERROR]", smsError?.message)
      return res.status(500).json({
        error: "Failed to send OTP via SMS",
        ...(process.env.NODE_ENV !== 'production' ? { details: smsError?.message } : {})
      })
    }
  } catch (error: any) {
    console.error("[OTP-START][UNCAUGHT]", error?.message)
    return res.status(500).json({
      error: "Failed to send OTP",
      ...(process.env.NODE_ENV !== 'production' ? { uncaught: error?.message } : {})
    })
  }
})

// Verify OTP: validate code and return a short-lived JWT proving verification
router.post("/otp/verify", async (req, res) => {
  try {
    const { mobileNumber, code } = req.body || {}
    if (!mobileNumber || !code) return res.status(400).json({ error: "mobileNumber and code are required" })

    const key = mobileNumber
    const record = otpStore.get(key)
    if (!record) return res.status(400).json({ error: "OTP not requested" })

    if (now() > record.expiresAt) {
      otpStore.delete(key)
      return res.status(400).json({ error: "OTP expired" })
    }

    if (record.attempts >= 5) {
      otpStore.delete(key)
      return res.status(429).json({ error: "Too many attempts. Request a new OTP." })
    }

    record.attempts += 1
    if (record.code !== String(code)) {
      return res.status(400).json({ error: "Invalid OTP code" })
    }

    // Success: issue a short-lived token binding this mobile number
    const verifiedToken = (jwt as any).sign(
      { purpose: "phone_verification", mobileNumber },
      OTP_JWT_SECRET as jwt.Secret,
      { expiresIn: OTP_JWT_EXPIRES }
    )
    // Clean up used record
    otpStore.delete(key)

    res.json({ success: true, verifiedMobileToken: verifiedToken, expiresIn: OTP_JWT_EXPIRES })
  } catch (error) {
    console.error("OTP verify error:", error)
    res.status(500).json({ error: "Failed to verify OTP" })
  }
})

// Issue a short-lived QR token for a given outlet; used to embed in the QR code URL
router.get("/qr-token/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
    if (!outlet || !outlet.isActive) {
      return res.status(404).json({ error: "Outlet not found or inactive" })
    }

    const token = (jwt as any).sign(
      { outletId, purpose: "customer_registration" },
      QR_JWT_SECRET as jwt.Secret,
      { expiresIn: QR_JWT_EXPIRES }
    )

    res.json({ token, expiresIn: QR_JWT_EXPIRES })
  } catch (error) {
    console.error("QR token issue error:", error)
    res.status(500).json({ error: "Failed to issue QR token" })
  }
})

// Validate a QR token (optional convenience endpoint for frontend gating)
router.get("/validate-qr", async (req, res) => {
  try {
    const token = (req.query.token as string) || ""
    if (!token || token === "default") {
      return res.status(400).json({ valid: false, error: "Missing or invalid token" })
    }

    const payload = (jwt as any).verify(token, QR_JWT_SECRET as jwt.Secret) as any
    if (payload?.purpose !== "customer_registration" || !payload?.outletId) {
      return res.status(400).json({ valid: false, error: "Invalid token" })
    }
    res.json({ valid: true, outletId: payload.outletId })
  } catch (error: any) {
    const msg = error?.name === "TokenExpiredError" ? "Token expired" : "Invalid token"
    res.status(401).json({ valid: false, error: msg })
  }
})

// Register customer and create token
router.post("/register", async (req, res) => {
  try {
    const { name, mobileNumber, serviceTypes, outletId, qrToken, preferredLanguages, sltMobileNumber, nicNumber, email, verifiedMobileToken, sltTelephoneNumber, billPaymentIntent, billPaymentAmount, billPaymentMethod } = req.body

    console.log(`Registration attempt - Mobile: ${mobileNumber}, Outlet: ${outletId}, Services: ${serviceTypes}`)

    // Validate input
    if (!name || !mobileNumber || !Array.isArray(serviceTypes) || serviceTypes.length === 0 || !outletId) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Enforce phone verification via OTP
    try {
      const payload = (jwt as any).verify(verifiedMobileToken || "", OTP_JWT_SECRET as jwt.Secret) as any
      if (payload?.purpose !== "phone_verification" || payload?.mobileNumber !== mobileNumber) {
        return res.status(403).json({ error: "Phone verification required" })
      }
    } catch {
      return res.status(403).json({ error: "Phone verification required" })
    }

    // Enforce QR gating: require a valid QR token bound to this outlet (unless outlet is specified directly)
    if (!qrToken && !outletId) {
      return res.status(403).json({ error: "QR verification required" })
    }

    // Try validating as JWT token first (legacy system)
    let validToken = false
    if (qrToken) {
      try {
        const payload = (jwt as any).verify(qrToken, QR_JWT_SECRET as jwt.Secret) as any
        if (payload?.purpose === "customer_registration" && payload?.outletId === outletId) {
          validToken = true
        }
      } catch (err) {
        // JWT validation failed, try manager QR token validation
      }
    }

    // If JWT validation failed, try manager QR token validation (in-memory and DB)
    if (!validToken && qrToken) {
      let outletFromManagerToken: string | null = null
      if (managerQRTokens.has(qrToken)) {
        const tokenData = managerQRTokens.get(qrToken)!
        outletFromManagerToken = tokenData.outletId
      } else {
        // Fallback to database persistence
        const dbToken = await prisma.managerQRToken.findUnique({ where: { token: qrToken } })
        if (dbToken) {
          outletFromManagerToken = dbToken.outletId
          // warm the in-memory cache to speed up subsequent checks
          managerQRTokens.set(qrToken, {
            outletId: dbToken.outletId,
            generatedAt: dbToken.generatedAt.toISOString(),
          })
        }
      }

      if (outletFromManagerToken) {
        if (outletFromManagerToken === outletId) {
          validToken = true
        } else {
          return res.status(403).json({ error: "QR token is not for this outlet" })
        }
      }
    }

    // If no QR token provided but outlet ID is valid, allow registration
    if (!qrToken && outletId) {
      // Verify the outlet exists and is active
      const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
      if (!outlet || !outlet.isActive) {
        return res.status(404).json({ error: "Outlet not found or inactive" })
      }
      validToken = true
    }

    // If neither validation method worked
    if (!validToken) {
      return res.status(401).json({ error: "Invalid QR token" })
    }


    const prioritySettingRows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting" WHERE "key" = 'priority_service_enabled' LIMIT 1
    `
    const priorityFeatureEnabled = prioritySettingRows[0]?.booleanValue ?? true

    // Check if any selected service is a priority service (auto-set isPriority)
    const priorityServices = await prisma.$queryRaw`
      SELECT id FROM "Service" WHERE "code" = ANY(${serviceTypes}::text[]) AND "isPriorityService" = true LIMIT 1
    ` as any[]
    const autoPriority = priorityFeatureEnabled && priorityServices.length > 0

    // Use a database transaction to prevent race conditions
    const token = await prisma.$transaction(async (tx) => {
      /* Check if customer already has an active token for this outlet
      const existingToken = await tx.token.findFirst({
        where: {
          outlet: { id: outletId },
          customer: { mobileNumber },
          status: { in: ["waiting", "in_service"] },
        },
        include: {
          customer: true,
          outlet: true,
        },
      })

      if (existingToken) {
        throw new Error(`Customer with mobile number ${mobileNumber} already has an active token (#${existingToken.tokenNumber}) for this outlet`)
      }*/
      // Allow multiple active tokens per mobile number; removed prior active-token restriction

      // Always create a new customer record even if mobileNumber repeats
      const customer = await tx.customer.create({
        data: {
          name,
          mobileNumber,
          sltMobileNumber: sltMobileNumber || undefined,
          nicNumber: nicNumber || undefined,
          email: email || undefined,
        },
      })

      // Use an exclusive lock on the Outlet record to serialize concurrent token generation
      await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${outletId} FOR UPDATE`

      // Get next token number for outlet within the current daily window (resets at 12:00 PM)
      const lastReset = getLastDailyReset()
      const lastToken = await tx.token.findFirst({
        where: { outletId, createdAt: { gte: lastReset } },
        orderBy: { tokenNumber: "desc" },
        select: { tokenNumber: true },
      })

      const tokenNumber = (lastToken?.tokenNumber || 0) + 1

      console.log(`Creating token #${tokenNumber} for customer ${name} (${mobileNumber}) at outlet ${outletId}`)

      // Create token within the same transaction
      const newToken = await tx.token.create({
        data: {
          tokenNumber,
          customerId: customer.id,
          serviceTypes,
          outletId,
          status: "waiting",
          isPriority: autoPriority,
          // Store preferredLanguages as a JSON array (not a string) for easier matching
          preferredLanguages: Array.isArray(preferredLanguages) && preferredLanguages.length > 0
            ? preferredLanguages
            : undefined,
          sltTelephoneNumber: sltTelephoneNumber?.trim() || null,
          billPaymentIntent: billPaymentIntent || null,
          billPaymentAmount: billPaymentIntent === 'partial' ? billPaymentAmount : null,
          billPaymentMethod: billPaymentMethod || null,
        },
        include: {
          customer: true,
          outlet: true,
        },
      })

      return newToken
    }, {
      timeout: 10000, // 10 second timeout to prevent long-running transactions
    })

    console.log(`Successfully created token #${token.tokenNumber} for customer ${token.customer.name}`)

    // Calculate queue position and estimated wait time
    const lastReset = getLastDailyReset()
    const queuePosition = await prisma.token.count({
      where: {
        outletId: token.outletId,
        status: "waiting",
        tokenNumber: { lt: token.tokenNumber },
        createdAt: { gte: lastReset },
      },
    }) + 1

    const estimatedWait = Math.max(1, queuePosition * 5) // 5 min per person, minimum 1 min

    // Broadcast update immediately so officer dashboards refresh without waiting on SMS delivery.
    broadcast({ type: "NEW_TOKEN", data: token })

    res.json({
      success: true,
      token,
      message: "Registration successful",
      queuePosition,
      estimatedWait,
    })

    // Send token confirmation SMS off the request path.
    void (async () => {
      try {
        const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
        
        // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
        const sltUrl = origins.find(o => o.includes('slt.lk'))
        const vercelUrl = origins.find(o => o.includes('vercel.app'))
        const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
        
        let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''

        const shortId = token.id.substring(0, 8)
        const trackingUrl = baseUrl ? `${baseUrl}/t/${shortId}` : `/t/${shortId}`
        const lang = Array.isArray(preferredLanguages) && preferredLanguages.length > 0
          ? normalizeLang(preferredLanguages[0])
          : normalizeLang(preferredLanguages)

        await sltSmsService.sendTokenConfirmation(token.customer.mobileNumber, {
          tokenNumber: token.tokenNumber,
          queuePosition,
          outletName: token.outlet?.name || 'SLT Office',
          trackingUrl,
          estimatedWait,
        }, lang)
        console.log(`✓ Token confirmation SMS sent to ${token.customer.mobileNumber}`)
      } catch (smsError) {
        console.error('Token confirmation SMS failed:', smsError)
      }
    })()
  } catch (error: any) {
    console.error("Registration error:", error)

    // Handle specific error cases
    if (error.message && error.message.includes("already has an active token")) {
      return res.status(409).json({ error: error.message })
    }

    // Handle database constraint violations
    if (error.code === 'P2002') {
      return res.status(409).json({ error: "A registration with this information already exists" })
    }

    res.status(500).json({ error: "Registration failed" })
  }
})

// Get token status and waiting time
router.get("/token/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      include: {
        customer: true,
        outlet: true,
        officer: true,
      },
    })

    if (!token) {
      return res.status(404).json({ error: "Token not found" })
    }

    // Calculate `position in queue`
    const lastReset = getLastDailyReset()
    const position = await prisma.token.count({
      where: {
        outletId: token.outletId,
        status: "waiting",
        tokenNumber: { lt: token.tokenNumber },
        createdAt: { gte: lastReset },
      },
    })

    // Calculate estimated wait time (5 minutes per person)
    const estimatedWaitMinutes = position * 5

    res.json({
      token,
      position: position + 1,
      estimatedWaitMinutes,
    })
  } catch (error) {
    console.error("Token fetch error:", error)
    res.status(500).json({ error: "Failed to fetch token" })
  }
})

// Cancel a token by customer
router.post("/token/:tokenId/cancel", async (req, res) => {
  try {
    const { tokenId } = req.params

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
    })

    if (!token) {
      return res.status(404).json({ error: "Token not found" })
    }

    // Only allow canceling if still waiting
    if (token.status !== "waiting") {
      return res.status(400).json({ error: "Only waiting tokens can be cancelled" })
    }

    const updatedToken = await prisma.token.update({
      where: { id: tokenId },
      data: { status: "cancelled" },
      include: {
        customer: true,
        outlet: true,
      }
    })

    // Broadcast update so officer dashboard and others refresh
    broadcast({ type: "TOKEN_CANCELLED", data: updatedToken })

    // Send Cancellation SMS
    try {
      const preferredLangs = Array.isArray(updatedToken.preferredLanguages) ? updatedToken.preferredLanguages : []
      const lang = preferredLangs.length > 0 ? normalizeLang(preferredLangs[0]) : 'en'

      await smsHelper.sendTokenCancellation(updatedToken.customer.mobileNumber, {
        tokenNumber: updatedToken.tokenNumber,
        outletName: updatedToken.outlet.name
      }, lang)
      console.log(`✓ Cancellation SMS sent to ${updatedToken.customer.mobileNumber} for token #${updatedToken.tokenNumber}`)
    } catch (smsErr) {
      console.error("Failed to send cancellation SMS:", smsErr)
    }

    res.json({
      success: true,
      message: "Token cancelled successfully",
      token: updatedToken
    })
  } catch (error) {
    console.error("Token cancel error:", error)
    res.status(500).json({ error: "Failed to cancel token" })
  }
})

// Update bill payment method — only allowed when token is in_service (officer has called the customer)
router.patch("/token/:tokenId/payment-method", async (req, res) => {
  try {
    const { tokenId } = req.params
    const { billPaymentIntent, billPaymentAmount, billPaymentMethod } = req.body

    if (!billPaymentIntent || !['full', 'partial'].includes(billPaymentIntent)) {
      return res.status(400).json({ error: "billPaymentIntent must be 'full' or 'partial'" })
    }
    if (!billPaymentMethod || !['cash', 'card', 'cheque', 'bank_transfer'].includes(billPaymentMethod)) {
      return res.status(400).json({ error: "billPaymentMethod must be 'cash', 'card', 'cheque', or 'bank_transfer'" })
    }

    const token = await prisma.token.findUnique({ where: { id: tokenId } })

    if (!token) {
      return res.status(404).json({ error: "Token not found" })
    }

    if (token.status !== 'in_service') {
      return res.status(400).json({ error: "Payment method can only be set after the officer has called you to the counter" })
    }

    const updatedToken = await prisma.token.update({
      where: { id: tokenId },
      data: {
        billPaymentMethod,
        billPaymentIntent,
        billPaymentAmount: billPaymentIntent === 'partial' ? (billPaymentAmount ?? null) : null,
      },
    })

    res.json({ success: true, token: updatedToken })
  } catch (error) {
    console.error("Payment method update error:", error)
    res.status(500).json({ error: "Failed to update payment method" })
  }
})

// Customer lookup by mobile number - for recovery scenarios  
router.post("/lookup", async (req, res) => {
  try {
    const { mobileNumber } = req.body

    if (!mobileNumber) {
      return res.status(400).json({ error: "Mobile number is required" })
    }

    // Build base URL for tracking links
    const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
    
    // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
    const sltUrl = origins.find(o => o.includes('slt.lk'))
    const vercelUrl = origins.find(o => o.includes('vercel.app'))
    const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
    
    let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''

    // Find all active tokens for this mobile number (last 24 hours to avoid too many results)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const tokens = await prisma.token.findMany({
      where: {
        customer: { mobileNumber },
        createdAt: { gte: yesterday },
        status: { in: ["waiting", "in_service", "completed"] }
      },
      include: {
        customer: true,
        outlet: true,
        officer: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5 // Limit to 5 most recent tokens
    })

    if (tokens.length === 0) {
      return res.status(404).json({
        error: "No recent tokens found for this mobile number",
        suggestion: "Please visit the counter or register a new token"
      })
    }

    // Calculate queue positions for waiting tokens
    const tokensWithDetails = await Promise.all(
      tokens.map(async (token) => {
        let queuePosition = null
        let estimatedWait = null

        if (token.status === 'waiting') {
          const lastReset = getLastDailyReset()
          queuePosition = await prisma.token.count({
            where: {
              outletId: token.outletId,
              status: "waiting",
              tokenNumber: { lt: token.tokenNumber },
              createdAt: { gte: lastReset },
            },
          }) + 1

          estimatedWait = Math.max(1, queuePosition * 5) // 5 min per person
        }

        return {
          id: token.id,
          tokenNumber: token.tokenNumber,
          status: token.status,
          createdAt: token.createdAt,
          calledAt: token.calledAt,
          completedAt: token.completedAt,
          counterNumber: token.counterNumber,
          outlet: {
            name: token.outlet?.name,
            location: token.outlet?.location
          },
          officer: token.officer ? {
            name: token.officer.name,
            counterNumber: token.officer.counterNumber
          } : null,
          queuePosition,
          estimatedWaitMinutes: estimatedWait,
          statusMessage: getStatusMessage(token.status, queuePosition || 0, estimatedWait || 0),
          trackingUrl: baseUrl ? `${baseUrl}/t/${token.id.substring(0, 8)}` : `/t/${token.id.substring(0, 8)}`
        }
      })
    )

    res.json({
      success: true,
      customerName: tokens[0].customer.name,
      mobileNumber: tokens[0].customer.mobileNumber,
      tokens: tokensWithDetails,
      message: tokensWithDetails.length === 1 ? "Token found" : `${tokensWithDetails.length} recent tokens found`
    })
  } catch (error) {
    console.error("Customer lookup error:", error)
    res.status(500).json({ error: "Failed to lookup customer tokens" })
  }
})

// Short URL redirect - resolve short token ID to full token details
router.get("/t/:shortId", async (req, res) => {
  try {
    const { shortId } = req.params

    if (shortId.length !== 8) {
      return res.status(400).json({ error: "Invalid short ID format" })
    }

    // Find token by first 8 characters of ID
    const token = await prisma.token.findFirst({
      where: {
        id: { startsWith: shortId }
      },
      include: {
        customer: true,
        outlet: true,
        officer: true,
      },
      orderBy: { createdAt: 'desc' } // Get most recent if multiple matches (unlikely but safe)
    })

    if (!token) {
      return res.status(404).json({ error: "Token not found" })
    }

    // Calculate position in queue if still waiting
    let queuePosition = 0
    let estimatedWait = 0

    if (token.status === 'waiting') {
      const lastReset = getLastDailyReset()
      queuePosition = await prisma.token.count({
        where: {
          outletId: token.outletId,
          status: "waiting",
          tokenNumber: { lt: token.tokenNumber },
          createdAt: { gte: lastReset },
        },
      }) + 1

      estimatedWait = Math.max(1, queuePosition * 5) // 5 min per person, minimum 1 min
    }

    res.json({
      token: {
        id: token.id,
        tokenNumber: token.tokenNumber,
        status: token.status,
        createdAt: token.createdAt,
        calledAt: token.calledAt,
        completedAt: token.completedAt,
        counterNumber: token.counterNumber,
        customer: {
          name: token.customer.name,
          mobileNumber: token.customer.mobileNumber
        },
        outlet: {
          name: token.outlet?.name,
          location: token.outlet?.location
        },
        officer: token.officer ? {
          name: token.officer.name,
          counterNumber: token.officer.counterNumber
        } : null
      },
      queuePosition: token.status === 'waiting' ? queuePosition : null,
      estimatedWaitMinutes: token.status === 'waiting' ? estimatedWait : null,
      statusMessage: getStatusMessage(token.status, queuePosition, estimatedWait),
      shortUrl: `/t/${shortId}`,
      fullUrl: `/track/${token.id}`
    })
  } catch (error) {
    console.error("Short URL resolution error:", error)
    res.status(500).json({ error: "Failed to resolve token" })
  }
})

// Customer tracking endpoint for SMS links
router.get("/track/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      include: {
        customer: true,
        outlet: true,
        officer: true,
      },
    })

    if (!token) {
      return res.status(404).json({ error: "Token not found" })
    }

    // Calculate position in queue if still waiting
    let queuePosition = 0
    let estimatedWait = 0

    if (token.status === 'waiting') {
      const lastReset = getLastDailyReset()
      queuePosition = await prisma.token.count({
        where: {
          outletId: token.outletId,
          status: "waiting",
          tokenNumber: { lt: token.tokenNumber },
          createdAt: { gte: lastReset },
        },
      }) + 1

      estimatedWait = Math.max(1, queuePosition * 5) // 5 min per person, minimum 1 min
    }

    res.json({
      token: {
        id: token.id,
        tokenNumber: token.tokenNumber,
        status: token.status,
        createdAt: token.createdAt,
        calledAt: token.calledAt,
        completedAt: token.completedAt,
        counterNumber: token.counterNumber,
        customer: {
          name: token.customer.name,
          mobileNumber: token.customer.mobileNumber
        },
        outlet: {
          name: token.outlet?.name,
          location: token.outlet?.location
        },
        officer: token.officer ? {
          name: token.officer.name,
          counterNumber: token.officer.counterNumber
        } : null
      },
      queuePosition: token.status === 'waiting' ? queuePosition : null,
      estimatedWaitMinutes: token.status === 'waiting' ? estimatedWait : null,
      statusMessage: getStatusMessage(token.status, queuePosition, estimatedWait)
    })
  } catch (error) {
    console.error("Token tracking error:", error)
    res.status(500).json({ error: "Failed to fetch token status" })
  }
})

// Helper function to generate user-friendly status messages
function getStatusMessage(status: string, queuePosition: number, estimatedWait: number): string {
  switch (status) {
    case 'waiting':
      return queuePosition === 1
        ? 'You are next in line!'
        : `You are position ${queuePosition} in the queue.`
    case 'in_service':
      return 'You are currently being served.'
    case 'completed':
      return 'Your service has been completed.'
    case 'skipped':
      return 'Your token was skipped. Please contact the counter.'
    default:
      return 'Token status unknown.'
  }
}

// Shared in-memory store for manager QR tokens (use Redis or database in production)
interface ManagerQRTokenData {
  outletId: string;
  generatedAt: string;
  // Removed expiresAt - tokens don't expire automatically
}

// Use global storage to share between different route files
declare global {
  var globalManagerQRTokens: Map<string, ManagerQRTokenData> | undefined;
}

if (!global.globalManagerQRTokens) {
  global.globalManagerQRTokens = new Map<string, ManagerQRTokenData>();
}

const managerQRTokens = global.globalManagerQRTokens;

// Manager QR Code endpoints
// Register a manager-generated QR token
router.post("/manager-qr-token", async (req, res) => {
  try {
    const { outletId, token, generatedAt } = req.body

    if (!outletId || !token) {
      return res.status(400).json({ error: "Missing outletId or token" })
    }

    // Verify the outlet exists and is active
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
    if (!outlet || !outlet.isActive) {
      return res.status(404).json({ error: "Outlet not found or inactive" })
    }

    // Store the manager QR token (no expiry - valid until manually refreshed)
    managerQRTokens.set(token, {
      outletId,
      generatedAt: generatedAt || new Date().toISOString()
    })

    // Persist in database for durability across restarts
    await prisma.managerQRToken.upsert({
      where: { token },
      update: {
        outletId,
        generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
      },
      create: {
        token,
        outletId,
        generatedAt: generatedAt ? new Date(generatedAt) : new Date(),
      },
    })

    res.json({
      success: true,
      message: "Manager QR token registered"
    })
  } catch (error) {
    // Log detailed prisma/DB error information for troubleshooting
    const anyErr: any = error
    console.error("Manager QR registration error:", anyErr)
    if (anyErr?.code) console.error("Prisma error code:", anyErr.code)
    if (anyErr?.meta) console.error("Prisma error meta:", anyErr.meta)
    if (anyErr?.message) console.error("Error message:", anyErr.message)
    if (anyErr?.stack) console.error("Error stack:", anyErr.stack)

    // Do not leak internals in production responses
    const isProd = process.env.NODE_ENV === "production"
    res.status(500).json({
      error: "Failed to register manager QR token",
      ...(isProd ? {} : { details: anyErr?.message, code: anyErr?.code, meta: anyErr?.meta })
    })
  }
})

// Validate a manager-generated QR token
router.get("/validate-manager-qr", async (req, res) => {
  try {
    const token = req.query.token as string
    if (!token) {
      return res.status(400).json({ valid: false, error: "Missing token" })
    }

    // Check in-memory store first, fallback to DB
    let tokenData = managerQRTokens.get(token)
    if (!tokenData) {
      const dbToken = await prisma.managerQRToken.findUnique({ where: { token } })
      if (!dbToken) {
        return res.status(400).json({ valid: false, error: "Invalid token" })
      }
      tokenData = {
        outletId: dbToken.outletId,
        generatedAt: dbToken.generatedAt.toISOString(),
      }
      managerQRTokens.set(token, tokenData)
    }

    // Manager tokens are valid until manually refreshed (no automatic expiry)
    res.json({
      valid: true,
      outletId: tokenData.outletId,
      generatedAt: tokenData.generatedAt
    })
  } catch (error) {
    console.error("Manager QR validation error:", error)
    res.status(500).json({ valid: false, error: "Validation failed" })
  }
})

export default router
