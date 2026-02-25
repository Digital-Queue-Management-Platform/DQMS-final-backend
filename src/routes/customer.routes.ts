import { Router } from "express"
import { prisma, broadcast } from "../server"
import { getLastDailyReset } from "../utils/resetWindow"
import * as jwt from "jsonwebtoken"
import Twilio from "twilio"

const router = Router()

const QR_JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const QR_JWT_EXPIRES = process.env.QR_JWT_EXPIRES || "5m" // short-lived token

// OTP verification config
const OTP_JWT_SECRET = process.env.OTP_JWT_SECRET || "otp-dev-secret"
const OTP_JWT_EXPIRES = process.env.OTP_JWT_EXPIRES || "10m"
// Note: Do NOT read Twilio env vars at module-load time because imports may run before dotenv.config().
// We'll read env and construct the client inside request handlers.

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

function toE164(mobile: string): string {
  // Default to Sri Lanka if starting with 0 and length 10: 07XXXXXXXX -> +947XXXXXXXX
  const cleaned = (mobile || "").replace(/\D/g, "")
  if (!cleaned) return mobile
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    return "+94" + cleaned.substring(1)
  }
  if (cleaned.startsWith("94") && cleaned.length === 11) {
    return "+" + cleaned
  }
  if (mobile.startsWith("+")) return mobile
  // As a fallback, prefix + if it seems already international without +
  return mobile.startsWith("+") ? mobile : "+" + cleaned
}

// Start OTP: send code to mobile
router.post("/otp/start", async (req, res) => {
  try {
    const { mobileNumber, preferredLanguage } = req.body || {}
    if (!mobileNumber) return res.status(400).json({ error: "mobileNumber is required" })
    // Read env at request time to avoid early-evaluation issues
    const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ""
    const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ""
    const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || ""
    const MSG_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || ""
    const OTP_DEV_MODE = process.env.OTP_DEV_MODE === "true"
    const OTP_DEV_ECHO = process.env.OTP_DEV_ECHO === "true"

    const twilioClient = (ACCOUNT_SID && AUTH_TOKEN) ? Twilio(ACCOUNT_SID, AUTH_TOKEN) : null
    const twilioConfigured = !!(twilioClient && (MSG_SERVICE_SID || FROM_NUMBER))

    // Debug instrumentation (non-secret) to trace 500 causes
    const debugMeta = {
      OTP_DEV_MODE,
      OTP_DEV_ECHO,
      hasTwilioClient: !!twilioClient,
      TWILIO_MESSAGING_SERVICE_SID_PRESENT: !!MSG_SERVICE_SID,
      TWILIO_FROM_NUMBER_PRESENT: !!FROM_NUMBER,
      twilioConfigured,
      preferredLanguage,
      rawMobileNumber: mobileNumber,
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log('[OTP-START][DEBUG] incoming request', debugMeta)
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

    const to = toE164(mobileNumber)
    // Localize OTP message by language; fallback to English
    const lang = (typeof preferredLanguage === 'string' ? preferredLanguage : 'en') as 'en' | 'si' | 'ta'
    const otpBodies: Record<'en' | 'si' | 'ta', string> = {
      en: `Your verification code is ${code}. It expires in 1 minute.`,
      si: `ඔබගේ තහවුරු කේතය ${code}. එය මිනිත්තුවකින් කල් ඉකුත් වේ.`,
      ta: `உங்கள் சரிபார்ப்பு குறியீடு ${code} ஆகும். இது 1 நிமிடத்தில் காலாவதியாகும்.`,
    }
    const body = otpBodies[otpBodies[lang] ? lang : 'en']

    // DEV mode takes precedence even if Twilio is configured
    if (OTP_DEV_MODE) {
      console.log(`[OTP-DEV] OTP for ${to}: ${code}`)
      return res.json({ success: true, message: "OTP sent (dev mode)", ...(OTP_DEV_ECHO ? { devCode: code } : {}) })
    }

    if (!twilioConfigured) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[OTP-START][ERROR] Twilio not configured', {
          hasTwilioClient: !!twilioClient,
          TWILIO_MESSAGING_SERVICE_SID_PRESENT: !!MSG_SERVICE_SID,
          TWILIO_FROM_NUMBER_PRESENT: !!FROM_NUMBER,
        })
      }
      return res.status(500).json({ error: "OTP service not configured", ...(process.env.NODE_ENV !== 'production' ? { details: 'Missing Twilio credentials', meta: debugMeta } : {}) })
    }

    // Prefer Messaging Service SID if available; fallback to from number
    const params: any = { to, body }
    if (MSG_SERVICE_SID) {
      params.messagingServiceSid = MSG_SERVICE_SID
    } else if (FROM_NUMBER) {
      params.from = FROM_NUMBER
    }

    // Wrap Twilio call to surface errors
    try {
      await twilioClient!.messages.create(params)
    } catch (twErr: any) {
      console.error('[OTP-START][TWILIO_ERROR]', twErr?.message, twErr?.code)
      return res.status(500).json({ error: 'Failed to send OTP via provider', ...(process.env.NODE_ENV !== 'production' ? { providerError: twErr?.message, code: twErr?.code } : {}) })
    }

    res.json({ success: true, message: "OTP sent" })
  } catch (error: any) {
    console.error("[OTP-START][UNCAUGHT]", error?.message)
    return res.status(500).json({ error: "Failed to send OTP", ...(process.env.NODE_ENV !== 'production' ? { uncaught: error?.message, stack: error?.stack } : {}) })
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
    const { name, mobileNumber, serviceTypes, outletId, qrToken, preferredLanguages, sltMobileNumber, nicNumber, email, verifiedMobileToken } = req.body

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
          // Store preferredLanguages as a JSON array (not a string) for easier matching
          preferredLanguages: Array.isArray(preferredLanguages) && preferredLanguages.length > 0
            ? preferredLanguages
            : undefined,
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

    // Broadcast update after successful transaction
    broadcast({ type: "NEW_TOKEN", data: token })

    res.json({
      success: true,
      token,
      message: "Registration successful",
    })
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
    const position = await prisma.token.count({
      where: {
        outletId: token.outletId,
        status: "waiting",
        tokenNumber: { lt: token.tokenNumber },
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
