import { Router } from "express"
import { prisma, broadcast } from "../server"
import { getLastDailyReset } from "../utils/resetWindow"
import * as jwt from "jsonwebtoken"
import otpService from "../services/otpService"
import sltSmsService from "../services/sltSmsService"
import { getTrackingUrl, getFeedbackUrl, getServiceStatusUrl } from "../utils/urlHelper"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
// No expiration for production system - officers need continuous access during shifts
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined

// Request OTP for officer login
router.post("/request-otp", async (req, res) => {
  try {
    const { mobileNumber } = req.body

    if (!mobileNumber) {
      return res.status(400).json({ error: "Mobile number is required" })
    }

    // Check if officer exists
    const officer = await prisma.officer.findUnique({
      where: { mobileNumber },
      select: { id: true, name: true }
    })

    if (!officer) {
      return res.status(404).json({ error: "Officer not found with this mobile number" })
    }

    // Generate and send OTP
    const result = await otpService.generateOTP(mobileNumber, 'officer', officer.name)

    if (!result.success) {
      return res.status(500).json({ error: result.message })
    }

    res.json({
      success: true,
      message: result.message,
      officerName: officer.name
    })
  } catch (error) {
    console.error("Request OTP error:", error)
    res.status(500).json({ error: "Failed to send OTP" })
  }
})

// Officer login with OTP verification
router.post("/login", async (req, res) => {
  try {
    const { mobileNumber, otpCode } = req.body

    if (!mobileNumber || !otpCode) {
      return res.status(400).json({ error: "Mobile number and OTP code are required" })
    }

    // Verify OTP
    const verifyResult = await otpService.verifyOTP(mobileNumber, otpCode, 'officer')

    if (!verifyResult.success) {
      return res.status(401).json({ error: verifyResult.message })
    }

    // Get officer details
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

    // Broadcast status change for real-time updates
    broadcast({
      type: "OFFICER_STATUS_CHANGE",
      data: {
        officerId: officer.id,
        status: "available",
        timestamp: new Date().toISOString()
      }
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

// Real-time duplicate check – called by frontend as user types
// GET /officer/check?mobile=0771234567   → { taken: true|false, field: 'mobile' }
// GET /officer/check?email=a@b.com       → { taken: true|false, field: 'email' }
router.get("/check", async (req, res) => {
  try {
    const { mobile, email } = req.query as { mobile?: string; email?: string }

    if (mobile) {
      const existing = await prisma.officer.findUnique({ where: { mobileNumber: mobile } })
      return res.json({
        taken: !!existing,
        field: 'mobile',
        message: existing
          ? `Mobile number ${mobile} is already registered to another officer`
          : null
      })
    }

    if (email) {
      // Officers don't store email in the DB, but check across Teleshop Managers too
      const existingManager = await prisma.teleshopManager.findFirst({ where: { email } })
      return res.json({
        taken: !!existingManager,
        field: 'email',
        message: existingManager
          ? `Email address ${email} is already registered in the system`
          : null
      })
    }

    return res.status(400).json({ error: "Provide mobile or email query param" })
  } catch (err) {
    console.error("Officer check error:", err)
    res.status(500).json({ error: "Check failed" })
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
    const { officerId, allowFallback, allowUnmatched } = req.body

    console.log(`Next token request - Officer: ${officerId}, AllowFallback: ${allowFallback}, AllowUnmatched: ${allowUnmatched}`)

    const officer = await prisma.officer.findUnique({
      where: { id: officerId },
      select: {
        id: true,
        name: true,
        outletId: true,
        counterNumber: true,
        assignedServices: true,
        languages: true,
      },
    })

    if (!officer) {
      console.log("Officer not found:", officerId)
      return res.status(404).json({ error: "Officer not found" })
    }

    console.log("Officer found:", officer.name, "Outlet:", officer.outletId)

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
        console.log("Error parsing assignedServices:", e)
        assignedServices = [];
      }
    }

    console.log("Assigned services:", assignedServices)

    // Parse officer languages (JSON array)
    let officerLanguages: string[] = []
    if (officer.languages) {
      try {
        if (Array.isArray(officer.languages)) {
          officerLanguages = officer.languages as string[]
        } else if (typeof officer.languages === 'string') {
          officerLanguages = JSON.parse(officer.languages)
        } else if (typeof officer.languages === 'object') {
          officerLanguages = Object.values(officer.languages).filter(v => typeof v === 'string') as string[]
        }
      } catch (e) {
        console.log("Error parsing officer languages:", e)
        officerLanguages = []
      }
    }

    const lastReset = getLastDailyReset()

    // Helper: normalize token preferred languages to array
    const toLangArray = (val: any): string[] => {
      try {
        if (!val) return []
        if (Array.isArray(val)) return val.filter(v => typeof v === 'string') as string[]
        if (typeof val === 'string') {
          const parsed = JSON.parse(val)
          return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []
        }
        if (typeof val === 'object') {
          // If stored as object-map, convert values
          return Object.values(val).filter(v => typeof v === 'string') as string[]
        }
      } catch { }
      return []
    }

    const hasAny = (a: string[], b: string[]) => a.some(x => b.some(y => String(x).toUpperCase() === String(y).toUpperCase()))

    let nextToken: any = null

    // If allowUnmatched is true, bypass strict matching and get ANY waiting token
    if (allowUnmatched) {
      console.log('⚠️ UNMATCHED MODE: Bypassing service/language matching')

      const unmatchedToken = await prisma.token.findFirst({
        where: {
          outletId: officer.outletId,
          status: 'waiting',
          isTransferred: false,
          createdAt: { gte: lastReset },
        },
        orderBy: { tokenNumber: 'asc' },
        include: { customer: true },
      })

      if (unmatchedToken) {
        nextToken = unmatchedToken
        console.log(`✓ Calling UNMATCHED token #${unmatchedToken.tokenNumber} by officer ${officer.name}`)
      } else {
        console.log('No waiting tokens available')
        return res.json({ message: 'No waiting tokens available' })
      }
    } else {
      // STRICT MATCHING: Officers must have both assigned services AND languages
      // Only tokens matching BOTH service AND language can be assigned

      console.log(`Officer ${officer.name} - Assigned Services:`, assignedServices, 'Languages:', officerLanguages)

      // Validate officer has required assignments
      if (assignedServices.length === 0) {
        console.log('Officer has no assigned services')
        return res.json({ error: 'You have no assigned services. Please contact your manager.' })
      }

      if (officerLanguages.length === 0) {
        console.log('Officer has no assigned languages')
        return res.json({ error: 'You have no assigned languages. Please contact your manager.' })
      }

      // TRANSFERRED CUSTOMER PRIORITY: Customers transferred to this counter already waited
      // in another queue — they must be served before new arrivals regardless of token number.
      if (officer.counterNumber && officer.counterNumber > 0) {
        const transferredForCounter = await prisma.token.findFirst({
          where: {
            outletId: officer.outletId,
            status: 'waiting',
            isTransferred: true,
            counterNumber: officer.counterNumber,
            serviceTypes: { hasSome: assignedServices },
            createdAt: { gte: lastReset },
          },
          orderBy: { createdAt: 'asc' }, // oldest total wait first
          include: { customer: true },
        })
        if (transferredForCounter) {
          nextToken = transferredForCounter
          console.log(`✓ TRANSFER PRIORITY: Token #${transferredForCounter.tokenNumber} served first (customer already waited in a previous queue)`)
        }
      }

      if (!nextToken) {
        // Get candidate tokens that match officer's assigned services
        // Priority 1: Tokens specifically assigned to THIS counter
        let candidateTokens = await prisma.token.findMany({
          where: {
            outletId: officer.outletId,
            status: 'waiting',
            isTransferred: false,
            counterNumber: officer.counterNumber && officer.counterNumber > 0 ? officer.counterNumber : undefined,
            serviceTypes: { hasSome: assignedServices },
            createdAt: { gte: lastReset },
          },
          orderBy: [
            { isPriority: 'desc' },
            { tokenNumber: 'asc' }
          ],
          take: 20,
          include: { customer: true },
        })

        // If no counter-specific tokens, look for general pool tokens (counterNumber is null)
        if (candidateTokens.length === 0) {
          candidateTokens = await prisma.token.findMany({
            where: {
              outletId: officer.outletId,
              status: 'waiting',
              isTransferred: false,
              counterNumber: null,
              serviceTypes: { hasSome: assignedServices },
              createdAt: { gte: lastReset },
            },
            orderBy: [
              { isPriority: 'desc' },
              { tokenNumber: 'asc' }
            ],
            take: 50,
            include: { customer: true },
          })
        }

        console.log(`Found ${candidateTokens.length} tokens with matching services`)

        // Filter by language match
        for (const t of candidateTokens) {
          const tokenLangs = toLangArray(t.preferredLanguages)
          console.log(`Token #${t.tokenNumber} - Services:`, t.serviceTypes, 'Languages:', tokenLangs)

          // If token has no language preference, any officer can serve it
          if (tokenLangs.length === 0) {
            nextToken = t
            console.log(`✓ Token #${t.tokenNumber} has no language preference - any officer can serve`)
            break
          }

          // Check if there's a language match
          if (hasAny(tokenLangs, officerLanguages)) {
            nextToken = t
            console.log(`✓ Matched Token #${t.tokenNumber} - Service + Language match`)
            break
          } else {
            console.log(`✗ Token #${t.tokenNumber} language mismatch - Token wants:`, tokenLangs, 'Officer has:', officerLanguages)
          }
        }
      } // end if (!nextToken) — skip regular matching when a transferred token was found

      if (!nextToken) {
        console.log('No tokens match your assigned services and languages')
        return res.json({ message: 'No tokens match your assigned services and languages right now' })
      }
    }

    // Assign the selected token to the officer
    console.log(`Assigning token #${nextToken.tokenNumber} to officer ${officer.name}`)

    // Atomic update to prevent race conditions (two officers calling same token)
    const assignResult = await prisma.token.updateMany({
      where: { id: nextToken.id, status: 'waiting' },
      data: {
        status: 'in_service',
        assignedTo: officerId,
        counterNumber: officer.counterNumber,
        calledAt: new Date(),
        startedAt: new Date(),
      },
    })

    if (assignResult.count === 0) {
      console.log(`Race condition avoided: Token #${nextToken.tokenNumber} was already called by another officer.`)
      return res.status(409).json({ error: 'This token has already been called by another officer. Please click Next again.' })
    }

    // Fetch the updated token with includes for SMS and broadcast
    const updatedToken = await prisma.token.findUnique({
      where: { id: nextToken.id },
      include: { customer: true, officer: true, outlet: true },
    })

    if (!updatedToken) return res.status(404).json({ error: 'Token lost after assignment' })

    await prisma.officer.update({ where: { id: officerId }, data: { status: 'serving' } })

    // Send SMS notification to customer
    try {
      const firstName = updatedToken.customer.name.split(' ')[0]

      const trackingUrl = getTrackingUrl(updatedToken.id)

      console.log(`[NEXT-TOKEN] About to send SMS to ${updatedToken.customer.mobileNumber} for token #${updatedToken.tokenNumber}`)

      const _prefs = (updatedToken as any).preferredLanguages
      let customerLang: 'en' | 'si' | 'ta' = 'en'
      if (Array.isArray(_prefs) && _prefs.length > 0) {
        const fp = String(_prefs[0]).toLowerCase()
        if (['en', 'si', 'ta'].includes(fp)) customerLang = fp as 'en' | 'si' | 'ta'
      } else if (typeof _prefs === 'string') {
        if (_prefs.includes('si')) customerLang = 'si'
        else if (_prefs.includes('ta')) customerLang = 'ta'
      }

      await sltSmsService.sendCustomerCalled(updatedToken.customer.mobileNumber, {
        firstName,
        tokenNumber: updatedToken.tokenNumber,
        counterNumber: officer.counterNumber || 0,
        outletName: updatedToken.outlet?.name || 'SLT Office',
        recoveryUrl: trackingUrl
      }, customerLang)
      console.log(`✓ Next-token SMS sent to customer ${updatedToken.customer.mobileNumber} for token #${updatedToken.tokenNumber}`)
    } catch (smsError) {
      console.error('Next-token SMS sending failed:', smsError)
      // Continue execution even if SMS fails
    }

    broadcast({ type: 'TOKEN_CALLED', data: updatedToken })

    const tokenLangs = toLangArray((updatedToken as any).preferredLanguages)
    return res.json({
      success: true,
      token: updatedToken,
      matchedBy: {
        service: assignedServices.some(s => (updatedToken.serviceTypes || []).includes(s)),
        language: officerLanguages.length > 0 ? hasAny(tokenLangs, officerLanguages) : false,
      }
    })

  } catch (error) {
    console.error("Next token error:", error)
    res.status(500).json({ error: "Failed to get next token" })
  }
})

// Get unmatched tokens - tokens that NO officer in the outlet can serve
router.get("/unmatched-tokens/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params
    const lastReset = getLastDailyReset()

    // Helper functions (reuse from next-token)
    const toLangArray = (val: any): string[] => {
      try {
        if (!val) return []
        if (Array.isArray(val)) return val.filter(v => typeof v === 'string') as string[]
        if (typeof val === 'string') {
          const parsed = JSON.parse(val)
          return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []
        }
        if (typeof val === 'object') {
          return Object.values(val).filter(v => typeof v === 'string') as string[]
        }
      } catch { }
      return []
    }

    const parseJsonArray = (val: any): string[] => {
      try {
        if (!val) return []
        if (Array.isArray(val)) return val as string[]
        if (typeof val === 'string') return JSON.parse(val)
        if (typeof val === 'object') return Object.values(val).filter(v => typeof v === 'string') as string[]
      } catch { }
      return []
    }

    const hasAny = (a: string[], b: string[]) => a.some(x => b.some(y => String(x).toUpperCase() === String(y).toUpperCase()))

    // Get all waiting AND skipped tokens (skipped tokens should still be visible for recall)
    const waitingTokens = await prisma.token.findMany({
      where: {
        outletId,
        status: {
          in: ['waiting', 'skipped']
        },
        createdAt: { gte: lastReset },
      },
      orderBy: { tokenNumber: 'asc' },
      include: { customer: true },
    })

    // Get all ONLINE/AVAILABLE officers in this outlet with their assignments
    // Only officers with status 'available' or 'serving' should be considered
    const officers = await prisma.officer.findMany({
      where: {
        outletId,
        status: {
          in: ['available', 'serving']
        }
      },
      select: { id: true, assignedServices: true, languages: true, status: true },
    })

    console.log(`Checking ${waitingTokens.length} tokens against ${officers.length} online officers for unmatched`)

    // Filter tokens that NO officer can serve
    const unmatchedTokens = waitingTokens.filter(token => {
      const tokenServices = Array.isArray(token.serviceTypes) ? token.serviceTypes as string[] : []
      const tokenLangs = toLangArray(token.preferredLanguages)

      // Skip if token has no service types or languages
      if (tokenServices.length === 0 || tokenLangs.length === 0) {
        return false
      }

      // Check if ANY officer can serve this token (service AND language match)
      const anyMatch = officers.some(officer => {
        const officerServices = parseJsonArray(officer.assignedServices)
        const officerLangs = parseJsonArray(officer.languages)

        // Officer must have both services and languages
        if (officerServices.length === 0 || officerLangs.length === 0) {
          return false
        }

        const serviceMatch = hasAny(tokenServices, officerServices)
        const langMatch = hasAny(tokenLangs, officerLangs)

        return serviceMatch && langMatch
      })

      // Return true if NO officer matches (unmatched token)
      const isUnmatched = !anyMatch
      if (isUnmatched) {
        console.log(`Token #${token.tokenNumber} is unmatched - Services: ${tokenServices.join(',')}, Languages: ${tokenLangs.join(',')}`)
      }
      return isUnmatched
    })

    console.log(`Found ${unmatchedTokens.length} unmatched tokens`)

    res.json({ unmatchedTokens })
  } catch (error) {
    console.error("Unmatched tokens error:", error)
    res.status(500).json({ error: "Failed to fetch unmatched tokens" })
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
      include: { customer: true, outlet: true },
    })

    // Send SMS notification to customer about skip
    try {
      const firstName = skipped.customer.name.split(' ')[0]

      // Build recovery URL
      const trackingUrl = getTrackingUrl(skipped.id)

      const _skipPrefs = (skipped as any).preferredLanguages
      let customerLang: 'en' | 'si' | 'ta' = 'en'
      if (Array.isArray(_skipPrefs) && _skipPrefs.length > 0) {
        const fp = String(_skipPrefs[0]).toLowerCase()
        if (['en', 'si', 'ta'].includes(fp)) customerLang = fp as 'en' | 'si' | 'ta'
      } else if (typeof _skipPrefs === 'string') {
        if (_skipPrefs.includes('si')) customerLang = 'si'
        else if (_skipPrefs.includes('ta')) customerLang = 'ta'
      }

      await sltSmsService.sendCustomerSkipped(skipped.customer.mobileNumber, {
        firstName,
        tokenNumber: skipped.tokenNumber,
        outletName: skipped.outlet?.name || 'SLT Office',
        recoveryUrl: trackingUrl
      }, customerLang)
      console.log(`✓ Skip SMS sent to customer ${skipped.customer.mobileNumber} for token #${skipped.tokenNumber}`)
    } catch (smsError) {
      console.error('Skip SMS sending failed:', smsError)
      // Continue execution even if SMS fails
    }

    // set officer back to available
    const updatedOfficer = await prisma.officer.update({ where: { id: officerId }, data: { status: 'available' } })

    // broadcast update
    broadcast({ type: 'TOKEN_SKIPPED', data: skipped })
    broadcast({ type: 'OFFICER_STATUS_CHANGE', data: { officerId, status: 'available', timestamp: new Date().toISOString() } })

    res.json({ success: true, token: skipped })
  } catch (error) {
    console.error('Skip token error:', error)
    res.status(500).json({ error: 'Failed to skip token' })
  }
})

// Re-announce current token (for central display)
router.post("/reannounce-token", async (req, res) => {
  try {
    const { tokenId, officerId } = req.body
    if (!tokenId) return res.status(400).json({ error: 'tokenId required' })

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      include: { customer: true, officer: true, outlet: true }
    })

    if (!token) return res.status(404).json({ error: 'Token not found' })

    // Only allow if it's currently in service or called
    if (token.status !== 'in_service') {
      return res.status(400).json({ error: 'Only in-service tokens can be re-announced' })
    }

    // Broadcast again. The central display will speak it.
    broadcast({ type: 'TOKEN_CALLED', data: token })

    return res.json({ success: true })
  } catch (err) {
    console.error('Re-announce error:', err)
    res.status(500).json({ error: 'Failed to re-announce token' })
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
      include: { customer: true, officer: true, outlet: true },
    })

    // Send SMS notification to customer about recall  
    try {
      const firstName = recalled.customer.name.split(' ')[0]

      // Build recovery URL
      const trackingUrl = getTrackingUrl(recalled.id)

      const _recallPrefs = (recalled as any).preferredLanguages
      let customerLang: 'en' | 'si' | 'ta' = 'en'
      if (Array.isArray(_recallPrefs) && _recallPrefs.length > 0) {
        const fp = String(_recallPrefs[0]).toLowerCase()
        if (['en', 'si', 'ta'].includes(fp)) customerLang = fp as 'en' | 'si' | 'ta'
      } else if (typeof _recallPrefs === 'string') {
        if (_recallPrefs.includes('si')) customerLang = 'si'
        else if (_recallPrefs.includes('ta')) customerLang = 'ta'
      }

      await sltSmsService.sendCustomerRecalled(recalled.customer.mobileNumber, {
        firstName,
        tokenNumber: recalled.tokenNumber,
        outletName: recalled.outlet?.name || 'SLT Office',
        recoveryUrl: trackingUrl,
        counterNumber: recalled.counterNumber || undefined
      }, customerLang)
      console.log(`✓ Recall SMS sent to customer ${recalled.customer.mobileNumber} for token #${recalled.tokenNumber}`)
    } catch (smsError) {
      console.error('Recall SMS sending failed:', smsError)
      // Continue execution even if SMS fails
    }

    // set officer to serving
    const updatedOfficer = await prisma.officer.update({ where: { id: officerId }, data: { status: 'serving' } })

    // broadcast update
    broadcast({ type: 'TOKEN_RECALLED', data: recalled })
    broadcast({ type: 'OFFICER_STATUS_CHANGE', data: { officerId, status: 'serving', timestamp: new Date().toISOString() } })

    res.json({ success: true, token: recalled })
  } catch (error) {
    console.error('Recall token error:', error)
    res.status(500).json({ error: 'Failed to recall token' })
  }
})



// Set token as VIP/Priority
router.post("/set-priority", async (req, res) => {
  try {
    const { tokenId } = req.body

    if (!tokenId) return res.status(400).json({ error: 'tokenId required' })

    const token = await prisma.token.findUnique({ where: { id: tokenId } })
    if (!token) return res.status(404).json({ error: 'Token not found' })

    // Update token to mark as priority
    const updated = await prisma.token.update({
      where: { id: tokenId },
      data: {
        isPriority: !token.isPriority, // Toggle priority status
      },
      include: {
        customer: true,
        outlet: true,
        officer: true,
      },
    })

    // Broadcast update
    broadcast({ type: 'TOKEN_PRIORITY_UPDATED', data: updated })

    res.json({ success: true, token: updated })
  } catch (error) {
    console.error('Set priority error details:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: 'Failed to set priority', details: errorMessage })
  }
})

// Call token to counter (for priority customers or any token)
router.post("/call-token", async (req, res) => {
  try {
    const { officerId, tokenId } = req.body

    if (!officerId || !tokenId) return res.status(400).json({ error: 'officerId and tokenId required' })

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) return res.status(404).json({ error: 'Officer not found' })

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      include: { customer: true, outlet: true }
    })
    if (!token) return res.status(404).json({ error: 'Token not found' })

    // Call token to counter (works for waiting or any status except completed)
    if (token.status === 'completed') {
      return res.status(400).json({ error: 'Cannot call completed token' })
    }

    // ATOMIC UPDATE: Ensure token is still waiting before calling it
    const callResult = await prisma.token.updateMany({
      where: { id: tokenId, status: 'waiting' },
      data: {
        status: 'in_service',
        assignedTo: officerId,
        counterNumber: officer.counterNumber,
        calledAt: new Date(),
        startedAt: new Date(),
      },
    })

    if (callResult.count === 0) {
      return res.status(409).json({ error: 'This token is no longer waiting. It may have been called, skipped, or cancelled.' })
    }

    const called = await prisma.token.findUnique({
      where: { id: tokenId },
      include: { customer: true, officer: true, outlet: true },
    })

    if (!called) return res.status(404).json({ error: 'Token lost after calling' })

    // set officer to serving
    const updatedOfficer = await prisma.officer.update({ where: { id: officerId }, data: { status: 'serving' } })
    broadcast({ type: 'OFFICER_STATUS_CHANGE', data: { officerId, status: 'serving', timestamp: new Date().toISOString() } })

    // Send SMS notification to customer
    try {
      const firstName = called.customer.name.split(' ')[0]

      // Build recovery URL for customer lookup
      const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
      
      // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
      const sltUrl = origins.find(o => o.includes('slt.lk'))
      const vercelUrl = origins.find(o => o.includes('vercel.app'))
      const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
      
      let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''

      const shortId = called.id.substring(0, 8)
      const recoveryUrl = baseUrl ? `${baseUrl}/t/${shortId}` : `/t/${shortId}`

      console.log(`[CALL-TOKEN] About to send SMS to ${called.customer.mobileNumber} for token #${called.tokenNumber}`)

      const _callPrefs = (called as any).preferredLanguages
      let customerLang: 'en' | 'si' | 'ta' = 'en'
      if (Array.isArray(_callPrefs) && _callPrefs.length > 0) {
        const fp = String(_callPrefs[0]).toLowerCase()
        if (['en', 'si', 'ta'].includes(fp)) customerLang = fp as 'en' | 'si' | 'ta'
      } else if (typeof _callPrefs === 'string') {
        if (_callPrefs.includes('si')) customerLang = 'si'
        else if (_callPrefs.includes('ta')) customerLang = 'ta'
      }

      await sltSmsService.sendCustomerCalled(called.customer.mobileNumber, {
        firstName,
        tokenNumber: called.tokenNumber,
        counterNumber: officer.counterNumber || 0,
        outletName: called.outlet?.name || 'SLT Office',
        recoveryUrl
      }, customerLang)
      console.log(`✓ Call-to-counter SMS sent to customer ${called.customer.mobileNumber} for token #${called.tokenNumber}`)
    } catch (smsError) {
      console.error('Call-to-counter SMS sending failed:', smsError)
      // Continue execution even if SMS fails
    }

    // Broadcast update
    broadcast({ type: 'TOKEN_CALLED', data: called })

    res.json({ success: true, token: called })
  } catch (error) {
    console.error('Call token error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: 'Failed to call token', details: errorMessage })
  }
})

// Announce a transferred token to its target counter without changing ownership.
router.post("/call-transferred-token", async (req, res) => {
  try {
    const { officerId, tokenId } = req.body

    if (!officerId || !tokenId) {
      return res.status(400).json({ error: 'officerId and tokenId required' })
    }

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) return res.status(404).json({ error: 'Officer not found' })

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      include: { customer: true, outlet: true },
    })

    if (!token) return res.status(404).json({ error: 'Token not found' })
    if (token.status !== 'waiting') {
      return res.status(400).json({ error: 'Only waiting tokens can be called to counter' })
    }
    if (!token.isTransferred) {
      return res.status(400).json({ error: 'This token is not a transferred token' })
    }

    // Security: only the officer who transferred this token can trigger this call action.
    const latestTransfer = await prisma.transferLog.findFirst({
      where: { tokenId: token.id },
      orderBy: { createdAt: 'desc' },
    })

    if (!latestTransfer || latestTransfer.fromOfficerId !== officerId) {
      return res.status(403).json({ error: 'You can only call tokens transferred by you' })
    }

    const targetCounter = token.counterNumber || latestTransfer.toCounterNumber || null
    if (!targetCounter) {
      return res.status(400).json({ error: 'Transferred token has no target counter' })
    }

    // Mark call timestamp for audit/visibility, keep token waiting for the target officer.
    const calledTransfer = await prisma.token.update({
      where: { id: token.id },
      data: { calledAt: new Date() },
      include: { customer: true, outlet: true },
    })

    // Send customer SMS that token is now called to the transferred counter.
    try {
      const firstName = calledTransfer.customer.name.split(' ')[0]
      const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
      
      // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
      const sltUrl = origins.find(o => o.includes('slt.lk'))
      const vercelUrl = origins.find(o => o.includes('vercel.app'))
      const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
      
      let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''
      const shortId = calledTransfer.id.substring(0, 8)
      const recoveryUrl = baseUrl ? `${baseUrl}/t/${shortId}` : `/t/${shortId}`

      const prefs = (calledTransfer as any).preferredLanguages
      let customerLang: 'en' | 'si' | 'ta' = 'en'
      if (Array.isArray(prefs) && prefs.length > 0) {
        const firstPref = String(prefs[0]).toLowerCase()
        if (['en', 'si', 'ta'].includes(firstPref)) {
          customerLang = firstPref as 'en' | 'si' | 'ta'
        }
      } else if (typeof prefs === 'string') {
        if (prefs.includes('si')) customerLang = 'si'
        else if (prefs.includes('ta')) customerLang = 'ta'
      }

      await sltSmsService.sendCustomerCalled(calledTransfer.customer.mobileNumber, {
        firstName,
        tokenNumber: calledTransfer.tokenNumber,
        counterNumber: targetCounter,
        outletName: calledTransfer.outlet?.name || 'SLT Office',
        recoveryUrl,
      }, customerLang)
      console.log(`✓ Transfer-call SMS sent to customer ${calledTransfer.customer.mobileNumber} for token #${calledTransfer.tokenNumber}`)
    } catch (smsError) {
      console.error('Transfer-call SMS sending failed:', smsError)
    }

    // Trigger UI refreshes; token remains in waiting state until target officer actually picks it.
    broadcast({ type: 'TOKEN_UPDATED', data: calledTransfer })

    res.json({
      success: true,
      message: `Customer called to Counter ${targetCounter}`,
      token: calledTransfer,
      counterNumber: targetCounter,
    })
  } catch (error) {
    console.error('Call transferred token error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: 'Failed to call transferred token', details: errorMessage })
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
        outlet: true,
        officer: true,
      },
    })


    // Update officer status back to available
    await prisma.officer.update({
      where: { id: officerId },
      data: { status: "available" },
    })

    // Broadcast update
    broadcast({ type: "TOKEN_COMPLETED", data: token })
    broadcast({ type: "OFFICER_STATUS_CHANGE", data: { officerId, status: "available", timestamp: new Date().toISOString() } })

    // Create or update ServiceCase (tracking), set status to completed, and print SMS to console
    try {
      let completedRef: string | null = null
      // Generate reference number: YYYY-MM-DD/OutletName/TokenNumber for uniqueness
      const refDate = new Date().toISOString().slice(0, 10)
      const outletName = (token.outlet?.name || 'Outlet').replace(/\//g, '-')
      const refNumber = `${refDate}/${outletName}/${token.tokenNumber}-${token.id.substring(0, 4)}`

      // Check if case exists for this token already
      let serviceCase = await (prisma as any).serviceCase.findFirst({ where: { tokenId: token.id } })
      if (!serviceCase) {
        serviceCase = await (prisma as any).serviceCase.create({
          data: {
            refNumber,
            tokenId: token.id,
            outletId: token.outletId,
            officerId,
            customerId: token.customerId,
            serviceTypes: (token as any).serviceTypes || [],
            status: 'completed',
            completedAt: new Date(),
          }
        })

        await (prisma as any).serviceCaseUpdate.create({
          data: {
            caseId: serviceCase.id,
            actorRole: 'officer',
            actorId: officerId,
            status: 'completed',
            note: 'Service completed by officer',
          }
        })
      } else {
        // If already exists, update status and completedAt
        await (prisma as any).serviceCase.update({
          where: { id: serviceCase.id },
          data: { status: 'completed', completedAt: new Date() }
        })

        await (prisma as any).serviceCaseUpdate.create({
          data: {
            caseId: serviceCase.id,
            actorRole: 'officer',
            actorId: officerId,
            status: 'completed',
            note: 'Service completed by officer',
          }
        })
      }
      completedRef = serviceCase.refNumber

      // Send SMS notification to customer with service completion and feedback link
      try {
        const firstName = token.customer.name.split(' ')[0]

        // Map service codes to titles for SMS
        const tokenServiceCodes = Array.isArray((token as any).serviceTypes) ? (token as any).serviceTypes : []
        const serviceRecords = await prisma.service.findMany({
          where: { code: { in: tokenServiceCodes } },
          select: { title: true }
        })
        const services = serviceRecords.map(s => s.title).join(', ') || 'Service'

        const feedbackUrl = getFeedbackUrl(token.id)

        // Detect customer language
        let customerLang: 'en' | 'si' | 'ta' = 'en'
        const prefs = (token as any).preferredLanguages
        if (Array.isArray(prefs) && prefs.length > 0) {
          const firstPref = String(prefs[0]).toLowerCase()
          if (['en', 'si', 'ta'].includes(firstPref)) customerLang = firstPref as 'en' | 'si' | 'ta'
        } else if (typeof prefs === 'string') {
          if (prefs.includes('si')) customerLang = 'si'
          else if (prefs.includes('ta')) customerLang = 'ta'
        }

        const isBillPayment = Array.isArray((token as any).serviceTypes) && ((token as any).serviceTypes.includes('SVC002') || (token as any).serviceTypes.includes('BILL_PAYMENT'))

        const completionTrackingUrl = getServiceStatusUrl(serviceCase.refNumber)

        if (isBillPayment) {
          // Resolve the actual payment amount for the SMS
          let billPaymentAmount: number | undefined = (token as any).billPaymentAmount ?? undefined
          if ((token as any).billPaymentIntent === 'full' && (token as any).sltTelephoneNumber) {
            try {
              const billRecord = await prisma.sltBill.findUnique({
                where: { telephoneNumber: (token as any).sltTelephoneNumber },
                select: { currentBill: true }
              })
              if (billRecord) billPaymentAmount = billRecord.currentBill
            } catch { /* ignore, amount stays undefined */ }
          }

          // Send bill payment confirmation SMS with payment details
          await sltSmsService.sendBillPaymentConfirmation(token.customer.mobileNumber, {
            firstName,
            tokenNumber: token.tokenNumber,
            outletName: token.outlet?.name || 'SLT Office',
            refNumber: serviceCase.refNumber,
            paymentIntent: (token as any).billPaymentIntent || 'not_specified',
            paymentAmount: billPaymentAmount,
            paymentMethod: (token as any).billPaymentMethod || undefined,
            trackingUrl: completionTrackingUrl,
            feedbackUrl,
          })
          console.log(`✓ Bill payment confirmation SMS sent to ${token.customer.mobileNumber}`)
        } else {
          await sltSmsService.sendServiceCompletion(token.customer.mobileNumber, {
            firstName,
            tokenNumber: token.tokenNumber,
            refNumber: serviceCase.refNumber,
            services,
            feedbackUrl,
            outletName: token.outlet?.name || 'SLT Office',
            trackingUrl: completionTrackingUrl,
          }, customerLang)
          console.log(`✓ Service completion SMS sent to ${token.customer.mobileNumber}`)
        }
      } catch (smsError) {
        console.error('SMS sending failed:', smsError)
        // Continue execution even if SMS fails
      }

      // "SMS" via console output with full tracking URL (for debug/legacy)
      try {
        const tokenServiceCodes = Array.isArray((token as any).serviceTypes) ? (token as any).serviceTypes : []
        const serviceRecords = await prisma.service.findMany({
          where: { code: { in: tokenServiceCodes } },
          select: { title: true }
        })
        const services = serviceRecords.map(s => s.title).join(', ') || ''
        const officerName = (token as any)?.officer?.name || 'Officer'
        const outlet = token.outlet?.name || ''

        // Build absolute tracking URL using same logic as below
        const trackRef = `/service/status?ref=${encodeURIComponent(serviceCase.refNumber)}`
        const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
        
        // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
        const sltUrl = origins.find(o => o.includes('slt.lk'))
        const vercelUrl = origins.find(o => o.includes('vercel.app'))
        const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
        
        let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''

        const trackUrl = baseUrl ? `${baseUrl}${trackRef}` : trackRef
        const msg = `Ref: ${serviceCase.refNumber} | Officer: ${officerName} | Outlet: ${outlet} | Services: ${services}. Track: ${trackUrl}`
        console.log(`[SMS][${token.customer.mobileNumber}] ${msg}`)
      } catch (e) {
        console.log('SMS print failed:', e)
      }
    } catch (err) {
      console.error('ServiceCase creation/update error:', err)
    }

    // Include the generated reference number and absolute tracking URL in response
    try {
      const caseRecord = await (prisma as any).serviceCase.findFirst({ where: { tokenId: token.id } })
      const refNumber = caseRecord?.refNumber || null
      const trackRef = refNumber ? `/service/status?ref=${encodeURIComponent(refNumber)}` : null
      // Build absolute URL for SMS so it becomes clickable
      const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
      
      // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
      const sltUrl = origins.find(o => o.includes('slt.lk'))
      const vercelUrl = origins.find(o => o.includes('vercel.app'))
      const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
      
      let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''

      const trackUrl = trackRef && baseUrl ? `${baseUrl}${trackRef}` : trackRef
      return res.json({ success: true, token, refNumber, trackRef, trackUrl })
    } catch {
      return res.json({ success: true, token, refNumber: null, trackRef: null, trackUrl: null })
    }
  } catch (error) {
    console.error("Complete service error:", error)
    res.status(500).json({ error: "Failed to complete service" })
  }
})

// Transfer current customer to another service/counter (keeps service open until final closure)
router.post("/transfer-token", async (req, res) => {
  console.log("[Transfer] Received request body:", JSON.stringify(req.body, null, 2))
  try {
    const { officerId, tokenId, newServiceTypes, targetCounterNumber, notes } = req.body

    if (!officerId || !tokenId || !newServiceTypes || !Array.isArray(newServiceTypes) || newServiceTypes.length === 0) {
      console.warn("[Transfer] Missing required fields")
      return res.status(400).json({ error: "officerId, tokenId and non-empty newServiceTypes array are required" })
    }

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) {
      console.warn(`[Transfer] Officer ${officerId} not found`)
      return res.status(404).json({ error: "Officer not found" })
    }

    const originalToken = await prisma.token.findUnique({
      where: { id: tokenId },
      include: { customer: true, outlet: true }
    })

    if (!originalToken) {
      console.warn(`[Transfer] Token ${tokenId} not found`)
      return res.status(404).json({ error: "Token not found" })
    }

    console.log(`[Transfer] Found original token #${originalToken.tokenNumber} for customer ${originalToken.customer.name}`)

    // Execute transfer in a transaction with extended timeout to prevent expiration
    const txStart = Date.now()
    const result = await prisma.$transaction(async (tx) => {
      const step1Start = Date.now()
      // 1. Update the existing token with new service types and counter, keep service OPEN
      console.log("[Transfer-Tx] Updating token with new service types and counter...")
      const updatedToken = await tx.token.update({
        where: { id: tokenId },
        data: {
          serviceTypes: newServiceTypes,
          counterNumber: targetCounterNumber ? Number(targetCounterNumber) : null,
          status: "waiting", // Put back in waiting queue for new officer to pick up
          assignedTo: null, // Unassign from current officer
          isPriority: true, // Priority for faster service
          isTransferred: true, // Mark as transferred for tracking
          // Keep completedAt as null - service is NOT closed
          // Keep accountRef unchanged - no "transferred" marker on same token
        },
        include: { customer: true, outlet: true }
      })
      console.log(`[Transfer-Tx] Step 1 (Token Update) took ${Date.now() - step1Start}ms`)

      const step2Start = Date.now()
      // 2. Create a TransferLog record for audit trail and reporting
      console.log("[Transfer-Tx] Creating transfer log entry...")
      await tx.transferLog.create({
        data: {
          tokenId: tokenId,
          fromOfficerId: officerId,
          fromCounterNumber: officer.counterNumber,
          toCounterNumber: targetCounterNumber ? Number(targetCounterNumber) : null,
          previousServiceTypes: originalToken.serviceTypes,
          newServiceTypes: newServiceTypes,
          notes: notes || null
        }
      })
      console.log(`[Transfer-Tx] Step 2 (Transfer Log) took ${Date.now() - step2Start}ms`)

      const step3Start = Date.now()
      // 3. Set officer back to available
      console.log("[Transfer-Tx] Resetting officer status to available...")
      const updatedOfficerTrans = await tx.officer.update({
        where: { id: officerId },
        data: { status: "available" }
      })
      console.log(`[Transfer-Tx] Step 3 (Officer) took ${Date.now() - step3Start}ms`)

      // 4. Create ServiceCaseUpdate for audit trail/customer dashboard
      const step4Start = Date.now()
      console.log("[Transfer-Tx] Creating service case update for tracking...")
      const sc = await tx.serviceCase.findFirst({ where: { tokenId: tokenId } })
      if (sc) {
        await tx.serviceCaseUpdate.create({
          data: {
            caseId: sc.id,
            actorRole: "OFFICER",
            actorId: officerId,
            status: "transferred",
            note: targetCounterNumber
              ? `Token transferred to Counter ${targetCounterNumber}. ${notes || ""}`.trim()
              : `Token transferred for further processing. ${notes || ""}`.trim()
          }
        })
      }
      console.log(`[Transfer-Tx] Step 4 (Case Update) took ${Date.now() - step4Start}ms`)

      return { updatedToken }
    }, {
      timeout: 20000 // Increase timeout to 20 seconds
    })

    console.log(`[Transfer] Transaction completed in ${Date.now() - txStart}ms. Token ID: ${result.updatedToken.id}`)

    // Broadcast token update
    try {
      broadcast({ type: "TOKEN_UPDATED", data: result.updatedToken })
      broadcast({ type: "OFFICER_STATUS_CHANGE", data: { officerId, status: "available", timestamp: new Date().toISOString() } })
      console.log("[Transfer] Broadcasts sent")
    } catch (broadcastErr) {
      console.error("[Transfer] Broadcast failed:", broadcastErr)
    }

    // Send SMS to customer about the transfer
    try {
      console.log("[Transfer-SMS] Preparing SMS notification...")
      const firstName = result.updatedToken.customer.name ? result.updatedToken.customer.name.split(" ")[0] : "Customer"

      // Map service codes to titles for SMS
      const tokenServiceCodes = Array.isArray(result.updatedToken.serviceTypes) ? result.updatedToken.serviceTypes : []
      const serviceRecords = await prisma.service.findMany({
        where: { code: { in: tokenServiceCodes } },
        select: { title: true }
      })
      const serviceNames = serviceRecords.map(s => s.title).join(", ") || "Service"

      // Extract first language from JSON field
      let lang: "en" | "si" | "ta" = "en"
      const prefs = originalToken.preferredLanguages

      if (Array.isArray(prefs) && prefs.length > 0) {
        const firstPref = String(prefs[0]).toLowerCase()
        if (["en", "si", "ta"].includes(firstPref)) {
          lang = firstPref as "en" | "si" | "ta"
        }
      } else if (typeof prefs === "string") {
        try {
          const parsed = JSON.parse(prefs)
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstPref = String(parsed[0]).toLowerCase()
            if (["en", "si", "ta"].includes(firstPref)) {
              lang = firstPref as "en" | "si" | "ta"
            }
          }
        } catch { }
      }

      // Build recovery URL
      const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
      
      // Always prioritize SLT URLs if available for tracking; maintain Vercel as backup
      const sltUrl = origins.find(o => o.includes('slt.lk'))
      const vercelUrl = origins.find(o => o.includes('vercel.app'))
      const prodUrl = origins.find(o => o.includes('https://') && !o.includes('localhost'))
      
      let baseUrl = sltUrl || vercelUrl || prodUrl || origins[0] || ''

      const outlet = result.updatedToken.outlet?.name || "SLT Office"
      const trackRef = `/t/${result.updatedToken.id.substring(0, 8)}`
      const recoveryUrl = baseUrl ? `${baseUrl}${trackRef}` : trackRef

      // Fetch refNumber for tracking
      const sc: any = await (prisma as any).serviceCase.findFirst({ where: { tokenId: result.updatedToken.id } })
      const refNumber = sc?.refNumber || undefined

      await sltSmsService.sendTokenTransfer(result.updatedToken.customer.mobileNumber, {
        tokenNumber: result.updatedToken.tokenNumber,
        outletName: outlet,
        serviceNames: serviceNames,
        targetCounterNumber: targetCounterNumber ? Number(targetCounterNumber) : undefined,
        recoveryUrl,
        refNumber
      }, lang)
      console.log(`✓ [Transfer-SMS] Sent successfully to ${result.updatedToken.customer.mobileNumber}`)
    } catch (smsError) {
      console.error("[Transfer-SMS] SMS failed:", smsError)
      // We don't fail the request if SMS fails
    }

    res.json({ success: true, token: result.updatedToken })
  } catch (error: any) {
    console.error("[Transfer] FATAL ERROR:", error)
    // Check for Prisma specific errors
    if (error.code === 'P2002') {
      return res.status(500).json({ error: "Transfer failed: Data consistency error" })
    }
    res.status(500).json({ error: "Failed to transfer token: " + (error.message || "Internal Server Error") })
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

    // Broadcast status change for real-time updates
    broadcast({
      type: "OFFICER_STATUS_CHANGE",
      data: {
        officerId: officer.id,
        status: officer.status,
        timestamp: new Date().toISOString()
      }
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

    // Broadcast status change for real-time updates
    broadcast({
      type: "OFFICER_STATUS_CHANGE",
      data: {
        officerId: officerId,
        status: "on_break",
        timestamp: new Date().toISOString()
      }
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

    // Broadcast status change for real-time updates
    broadcast({
      type: "OFFICER_STATUS_CHANGE",
      data: {
        officerId: officerId,
        status: "available",
        timestamp: new Date().toISOString()
      }
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

    // If the current token is a bill payment service, fetch the SLT bill data
    let billData = null
    if (currentToken && ((currentToken.serviceTypes as string[]).includes('SVC002') || (currentToken.serviceTypes as string[]).includes('BILL_PAYMENT')) && (currentToken as any).sltTelephoneNumber) {
      try {
        billData = await prisma.sltBill.findUnique({
          where: { telephoneNumber: (currentToken as any).sltTelephoneNumber },
          select: {
            telephoneNumber: true,
            accountName: true,
            accountAddress: true,
            currentBill: true,
            dueDate: true,
            status: true,
            lastPaymentDate: true,
            updatedAt: true,
          }
        })
      } catch (billError) {
        console.error('Failed to fetch bill data for token:', billError)
      }
    }

    res.json({
      tokensHandled,
      avgRating: avgRating._avg.rating || 0,
      currentToken,
      billData,
    })
  } catch (error) {
    console.error("Stats error:", error)
    res.status(500).json({ error: "Failed to fetch stats" })
  }
})

// Get combined officer dashboard data (Performance optimization)
router.get("/dashboard-combined", async (req, res) => {
  try {
    // 1. Authenticate
    let token = req.cookies?.dq_jwt
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7)
    }
    if (!token) return res.status(401).json({ error: "Not authenticated" })

    let payload: any
    try {
      payload = (jwt as any).verify(token, JWT_SECRET)
    } catch (e) {
      return res.status(401).json({ error: "Invalid token" })
    }

    const { officerId } = payload
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const lastReset = getLastDailyReset()

    // 2. Fetch basic officer data first
    const officer = await prisma.officer.findUnique({ 
      where: { id: officerId }, 
      include: { outlet: true } 
    })
    
    if (!officer) return res.status(404).json({ error: "Officer not found" })

    const outletId = officer.outletId

    // 3. Run all other queries in parallel
    const [
      tokensHandled,
      avgRatingAgg,
      currentToken,
      breaks,
      feedbackTokens,
      waitingTokens,
      allInServiceTokens,
      availableOfficersCount,
      servedTokens
    ] = await Promise.all([
      // Stats: Handled today
      prisma.token.count({ 
        where: { assignedTo: officerId, status: { in: ['completed', 'served'] }, completedAt: { gte: today } } 
      }),
      // Stats: Avg Rating
      prisma.feedback.aggregate({
        where: { token: { assignedTo: officerId, completedAt: { gte: today } } },
        _avg: { rating: true },
      }),
      // Current token for this officer
      prisma.token.findFirst({
        where: { assignedTo: officerId, status: "in_service" },
        include: { customer: true },
      }),
      // Today\'s breaks
      prisma.breakLog.findMany({
        where: { officerId, startedAt: { gte: today } },
        orderBy: { startedAt: 'desc' }
      }),
      // Today\'s feedback (with comments)
      prisma.token.findMany({
        where: {
          assignedTo: officerId,
          status: { in: ["completed", "served"] },
          completedAt: { gte: today },
          feedback: { isNot: null },
        },
        include: { customer: true, feedback: true },
        orderBy: { completedAt: "desc" },
      }),
      // Queue: Waiting tokens for this outlet
      prisma.token.findMany({
        where: {
          outletId,
          status: { in: ["waiting", "skipped"] },
          createdAt: { gte: lastReset },
        },
        orderBy: { tokenNumber: "asc" },
        include: { customer: true },
        take: 50
      }),
      // Queue: All in-service tokens for this outlet
      prisma.token.findMany({
        where: {
          outletId,
          status: "in_service",
          createdAt: { gte: lastReset },
        },
        include: { customer: true, officer: true },
      }),
      // Queue: Online officers count
      prisma.officer.count({
        where: {
          outletId,
          status: { in: ["available", "serving"] },
          lastLoginAt: { gte: lastReset }
        },
      }),
      // Summary: Last 10 served tokens for dash list
      prisma.token.findMany({
        where: {
          assignedTo: officerId,
          status: { in: ["completed", "served"] },
          completedAt: { gte: today },
        },
        include: { customer: true },
        orderBy: { completedAt: "desc" },
        take: 10
      })
    ])

    // Format Response
    const breakData = breaks.map(brk => {
      const duration = brk.endedAt 
        ? Math.floor((brk.endedAt.getTime() - brk.startedAt.getTime()) / (1000 * 60))
        : Math.floor((Date.now() - brk.startedAt.getTime()) / (1000 * 60))
      return {
        id: brk.id,
        startedAt: brk.startedAt.toISOString(),
        endedAt: brk.endedAt?.toISOString() || null,
        durationMinutes: duration,
        isActive: !brk.endedAt
      }
    })

    const feedbackList = feedbackTokens.map(token => ({
      tokenId: token.id,
      tokenNumber: token.tokenNumber,
      rating: token.feedback!.rating,
      comment: token.feedback!.comment || "",
      customerName: token.customer?.name || "Anonymous",
      createdAt: token.feedback!.createdAt.toISOString(),
    }))

    // Calculate avg handle time for servedSummary
    const totalMinutes = servedTokens.reduce((sum, t) => {
      if (t.startedAt && t.completedAt) {
        return sum + (t.completedAt.getTime() - t.startedAt.getTime()) / (1000 * 60)
      }
      return sum
    }, 0)
    const avgHandleMinutes = servedTokens.length > 0 ? Math.round(totalMinutes / servedTokens.length * 10) / 10 : 0

    res.json({
      officer,
      stats: {
        tokensHandled,
        avgRating: Math.round((avgRatingAgg._avg.rating || 0) * 10) / 10,
        currentToken,
      },
      queue: {
        waiting: waitingTokens,
        inService: allInServiceTokens.filter(t => t.assignedTo === officerId), // Dashboard only cares about self in summary cards?
        availableOfficers: availableOfficersCount,
        totalWaiting: waitingTokens.length,
      },
      servedSummary: {
        total: servedTokens.length,
        avgHandleMinutes,
        tokens: servedTokens,
      },
      breaksSummary: {
        totalBreaks: breakData.length,
        totalMinutes: breakData.reduce((s, b) => s + b.durationMinutes, 0),
        breaks: breakData,
        activeBreak: breakData.find(b => b.isActive) || null
      },
      feedbackSummary: {
        total: feedbackList.length,
        avgRating: feedbackList.length > 0 ? Math.round((feedbackList.reduce((s, f) => s + f.rating, 0) / feedbackList.length) * 10) / 10 : 0,
        feedback: feedbackList
      }
    })
  } catch (error) {
    console.error("Dashboard combined error:", error)
    res.status(500).json({ error: "Failed to fetch dashboard data" })
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
    const { from, to } = req.query

    const officer = await prisma.officer.findUnique({ where: { id: officerId } })
    if (!officer) {
      return res.status(404).json({ error: "Officer not found" })
    }

    // Determine date range: use query params if provided, otherwise default to today
    let startDate: Date
    let endDate: Date

    if (from && to) {
      // Use provided date range
      startDate = new Date(from as string)
      startDate.setHours(0, 0, 0, 0)
      endDate = new Date(to as string)
      endDate.setHours(23, 59, 59, 999)
    } else if (from) {
      // Only start date provided - from that date to now
      startDate = new Date(from as string)
      startDate.setHours(0, 0, 0, 0)
      endDate = new Date()
    } else if (to) {
      // Only end date provided - from beginning to that date
      startDate = new Date(0) // epoch
      endDate = new Date(to as string)
      endDate.setHours(23, 59, 59, 999)
    } else {
      // Default to today
      startDate = new Date()
      startDate.setHours(0, 0, 0, 0)
      endDate = new Date(startDate)
      endDate.setDate(endDate.getDate() + 1)
    }

    const tokens = await prisma.token.findMany({
      where: {
        assignedTo: officerId,
        status: { in: ["completed", "served"] },
        completedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        customer: true,
        officer: true,
      },
      orderBy: { completedAt: "desc" },
    })

    // Load related service case ref numbers for these tokens
    const tokenIds = tokens.map(t => t.id)
    const cases = tokenIds.length > 0
      ? await (prisma as any).serviceCase.findMany({
        where: { tokenId: { in: tokenIds } },
        select: { tokenId: true, refNumber: true },
      })
      : []
    const refByToken = new Map<string, string>()
    for (const c of cases) {
      if (c?.tokenId && c?.refNumber) refByToken.set(c.tokenId, c.refNumber)
    }

    // Calculate average handling time
    const totalMinutes = tokens.reduce((sum, token) => {
      if (token.startedAt && token.completedAt) {
        const diff = token.completedAt.getTime() - token.startedAt.getTime()
        return sum + (diff / 1000 / 60) // Convert to minutes
      }
      return sum
    }, 0)

    const avgHandleMinutes = tokens.length > 0 ? Math.round(totalMinutes / tokens.length * 100) / 100 : 0

    // Also load service case status for each token
    const serviceCases = tokenIds.length > 0
      ? await (prisma as any).serviceCase.findMany({
        where: { tokenId: { in: tokenIds } },
        select: { tokenId: true, status: true },
      })
      : []
    const statusByToken = new Map<string, string>()
    for (const c of serviceCases) {
      if (c?.tokenId && c?.status) statusByToken.set(c.tokenId, c.status)
    }

    res.json({
      total: tokens.length,
      avgHandleMinutes,
      tokens: tokens.map(token => ({
        ...token,
        customerName: token.customer?.name || 'Anonymous',
        customerMobile: token.customer?.mobileNumber || null,
        assignedOfficerName: token.officer?.name || null,
        serviceNames: Array.isArray(token.serviceTypes) && token.serviceTypes.length > 0 ? token.serviceTypes : ['General Service'],
        refNumber: refByToken.get(token.id) || null,
        serviceCaseStatus: statusByToken.get(token.id) || null,
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

// Add service case update (officer perspective)
router.post("/service-case/update", async (req, res) => {
  try {
    // Get officer from JWT
    let token = req.cookies?.dq_jwt
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

    const officerId = payload.officerId
    const { refNumber, note } = req.body || {}

    if (!refNumber || !note) {
      return res.status(400).json({ error: 'refNumber and note are required' })
    }

    const sc: any = await (prisma as any).serviceCase.findUnique({ where: { refNumber } })
    if (!sc) return res.status(404).json({ error: 'Service case not found' })
    // Authorization: only the officer who originally handled (serviceCase.officerId) may update
    if (sc.officerId !== officerId) {
      return res.status(403).json({ error: 'Not authorized to update this service case' })
    }

    const upd = await (prisma as any).serviceCaseUpdate.create({
      data: {
        caseId: sc.id,
        actorRole: 'officer',
        actorId: officerId,
        status: 'in_progress',
        note,
      }
    })

    await (prisma as any).serviceCase.update({ where: { id: sc.id }, data: { lastUpdatedAt: new Date() } })

    res.json({ success: true, update: upd })
  } catch (error) {
    console.error('Officer service case update error:', error)
    res.status(500).json({ error: 'Failed to add update' })
  }
})

// Mark a service case completed (officer perspective)
router.post("/service-case/complete", async (req, res) => {
  try {
    // Authenticate officer
    let token = req.cookies?.dq_jwt
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.substring(7)
    }
    if (!token) return res.status(401).json({ error: 'Not authenticated' })

    let payload: any
    try { payload = (jwt as any).verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Invalid token' }) }

    const officerId = payload.officerId
    const { refNumber, note } = req.body || {}
    if (!refNumber) return res.status(400).json({ error: 'refNumber is required' })

    const sc: any = await (prisma as any).serviceCase.findUnique({ where: { refNumber } })
    if (!sc) return res.status(404).json({ error: 'Service case not found' })
    if (sc.officerId !== officerId) return res.status(403).json({ error: 'Not authorized to complete this service case' })
    if (sc.status === 'completed') return res.json({ success: true, case: sc, message: 'Already completed' })

    const updated = await (prisma as any).serviceCase.update({
      where: { id: sc.id },
      data: { status: 'completed', completedAt: new Date(), lastUpdatedAt: new Date() }
    })

    await (prisma as any).serviceCaseUpdate.create({
      data: {
        caseId: sc.id,
        actorRole: 'officer',
        actorId: officerId,
        status: 'completed',
        note: note || 'Marked completed',
      }
    })

    return res.json({ success: true, case: updated })
  } catch (e) {
    console.error('Officer service-case complete error:', e)
    res.status(500).json({ error: 'Failed to complete service case' })
  }
})

// Officer-auth: Get a service case by refNumber - any case from the officer's outlet
router.get("/service-case/*", async (req, res) => {
  try {
    // Authenticate officer via JWT (cookie or Authorization header)
    let token = req.cookies?.dq_jwt
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

    const officerId = payload.officerId

    // Look up officer to get outletId for authorization
    const officer = await prisma.officer.findUnique({
      where: { id: officerId },
      select: { id: true, outletId: true }
    })
    if (!officer) return res.status(401).json({ error: "Officer not found" })

    const refNumber = decodeURIComponent((req.params as any)[0])
    if (!refNumber) return res.status(400).json({ error: 'refNumber is required' })

    const sc: any = await (prisma as any).serviceCase.findUnique({
      where: { refNumber },
      include: {
        customer: true,
        officer: true,
        outlet: true,
        token: {
          include: {
            feedback: true,
            transferLogs: {
              include: {
                fromOfficer: { select: { id: true, name: true, counterNumber: true } }
              },
              orderBy: { createdAt: 'asc' }
            }
          }
        },
        updates: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!sc) return res.status(404).json({ error: 'Reference not found' })

    // Authorization: officer must belong to the same outlet as the service case
    if (sc.outletId !== officer.outletId) {
      return res.status(403).json({ error: 'Not authorized to view this service case' })
    }

    // Resolve service titles from codes
    const serviceCodes: string[] = sc.serviceTypes || []
    const serviceRecords = serviceCodes.length > 0
      ? await prisma.service.findMany({
          where: { code: { in: serviceCodes } },
          select: { code: true, title: true }
        })
      : []
    const serviceTitleMap: Record<string, string> = {}
    for (const s of serviceRecords) serviceTitleMap[s.code] = s.title

    const tok = sc.token
    const feedback = tok?.feedback || null

    const waitDurationMs = tok?.calledAt && tok?.createdAt
      ? new Date(tok.calledAt).getTime() - new Date(tok.createdAt).getTime()
      : null
    const serviceDurationMs = tok?.completedAt && tok?.startedAt
      ? new Date(tok.completedAt).getTime() - new Date(tok.startedAt).getTime()
      : null
    const totalDurationMs = tok?.completedAt && tok?.createdAt
      ? new Date(tok.completedAt).getTime() - new Date(tok.createdAt).getTime()
      : null

    return res.json({
      refNumber: sc.refNumber,
      status: sc.status,
      serviceTypes: sc.serviceTypes,
      services: (sc.serviceTypes || []).map((code: string) => ({
        code,
        title: serviceTitleMap[code] || code
      })),
      createdAt: sc.createdAt,
      completedAt: sc.completedAt,
      lastUpdatedAt: sc.lastUpdatedAt,
      isOwnCase: sc.officerId === officerId,
      outlet: { id: sc.outlet.id, name: sc.outlet.name, location: sc.outlet.location },
      customer: {
        id: sc.customer.id,
        name: sc.customer.name,
        mobileNumber: sc.customer.mobileNumber,
        nicNumber: sc.customer.nicNumber || null,
        email: sc.customer.email || null,
        sltMobileNumber: sc.customer.sltMobileNumber || null,
      },
      officer: {
        id: sc.officer.id,
        name: sc.officer.name,
        mobileNumber: sc.officer.mobileNumber,
        counterNumber: sc.officer.counterNumber || null,
      },
      token: tok ? {
        id: tok.id,
        tokenNumber: tok.tokenNumber,
        isPriority: tok.isPriority,
        isTransferred: tok.isTransferred,
        preferredLanguages: tok.preferredLanguages,
        accountRef: tok.accountRef || null,
        sltTelephoneNumber: tok.sltTelephoneNumber || null,
        billPaymentIntent: tok.billPaymentIntent || null,
        billPaymentAmount: tok.billPaymentAmount ?? null,
        billPaymentMethod: tok.billPaymentMethod || null,
        createdAt: tok.createdAt,
        calledAt: tok.calledAt || null,
        startedAt: tok.startedAt || null,
        completedAt: tok.completedAt || null,
      } : null,
      timeSpans: {
        waitDurationMs,
        serviceDurationMs,
        totalDurationMs,
      },
      transferLogs: (tok?.transferLogs || []).map((tl: any) => ({
        id: tl.id,
        fromOfficer: tl.fromOfficer,
        fromCounterNumber: tl.fromCounterNumber,
        toCounterNumber: tl.toCounterNumber,
        previousServiceTypes: tl.previousServiceTypes,
        newServiceTypes: tl.newServiceTypes,
        notes: tl.notes,
        createdAt: tl.createdAt,
      })),
      feedback: feedback ? {
        rating: feedback.rating,
        comment: feedback.comment || null,
        createdAt: feedback.createdAt,
        isResolved: (feedback as any).isResolved || false,
        resolutionComment: (feedback as any).resolutionComment || null,
      } : null,
      updates: (sc.updates as any[]).map((u: any) => ({
        id: u.id,
        actorRole: u.actorRole,
        actorId: u.actorId,
        status: u.status,
        note: u.note,
        createdAt: u.createdAt,
      }))
    })
  } catch (e) {
    console.error('Officer service-case get error:', e)
    res.status(500).json({ error: 'Failed to fetch reference' })
  }
})

// Logout: clear cookie
router.post("/logout", async (req, res) => {
  try {
    // Try to set officer status to offline based on JWT cookie
    let token = req.cookies?.dq_jwt
    if (!token) {
      const authHeader = req.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }

    if (token) {
      try {
        const payload: any = (jwt as any).verify(token, JWT_SECRET)
        if (payload?.officerId) {
          await prisma.officer.update({
            where: { id: payload.officerId },
            data: { status: 'offline' },
          })

          // Broadcast status change for real-time updates
          broadcast({
            type: "OFFICER_STATUS_CHANGE",
            data: {
              officerId: payload.officerId,
              status: "offline",
              timestamp: new Date().toISOString()
            }
          })
        }
      } catch (e) {
        // ignore invalid/expired token
      }
    }

    res.clearCookie("dq_jwt", { path: "/" })
    res.json({ success: true })
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json({ error: "Logout failed" })
  }
})

// Helper: verify officer JWT and return officer record
async function getOfficerFromRequest(req: any): Promise<any | null> {
  let token = req.cookies?.dq_jwt
  if (!token) {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7)
  }
  if (!token) return null
  try {
    const payload: any = (jwt as any).verify(token, JWT_SECRET)
    const officer = await prisma.officer.findUnique({ where: { id: payload.officerId } })
    return officer || null
  } catch {
    return null
  }
}

// Branch Notices — officer can only view notices for their outlet
router.get("/branch-notices", async (req: any, res) => {
  try {
    const officer = await getOfficerFromRequest(req)
    if (!officer) return res.status(401).json({ error: "Authentication required" })
    if (!officer.outletId) return res.status(400).json({ error: "Officer is not assigned to an outlet" })

    const notices = await (prisma as any).closureNotice.findMany({
      where: { outletId: officer.outletId },
      orderBy: { startsAt: "asc" }
    })
    res.json({ success: true, notices })
  } catch (error) {
    console.error("Officer get branch notices error:", error)
    res.status(500).json({ error: "Failed to fetch notices" })
  }
})

export default router
