import { Router } from "express"
import { prisma, broadcast } from "../server"
import { getLastDailyReset } from "../utils/resetWindow"
import * as jwt from "jsonwebtoken"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
// No expiration for production system - officers need continuous access during shifts
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined

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

    const hasAny = (a: string[], b: string[]) => a.some(x => b.includes(x))

    let nextToken: any = null

    // If allowUnmatched is true, bypass strict matching and get ANY waiting token
    if (allowUnmatched) {
      console.log('⚠️ UNMATCHED MODE: Bypassing service/language matching')

      const unmatchedToken = await prisma.token.findFirst({
        where: {
          outletId: officer.outletId,
          status: 'waiting',
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

      // Get candidate tokens that match officer's assigned services
      const candidateTokens = await prisma.token.findMany({
        where: {
          outletId: officer.outletId,
          status: 'waiting',
          serviceTypes: { hasSome: assignedServices },
          createdAt: { gte: lastReset },
        },
        orderBy: { tokenNumber: 'asc' },
        take: 50, // Increased to find more matches
        include: { customer: true },
      })

      console.log(`Found ${candidateTokens.length} tokens with matching services`)

      // Filter by language match
      for (const t of candidateTokens) {
        const tokenLangs = toLangArray(t.preferredLanguages)
        console.log(`Token #${t.tokenNumber} - Services:`, t.serviceTypes, 'Languages:', tokenLangs)

        // If token has no language preference, skip it in strict mode
        if (tokenLangs.length === 0) {
          console.log(`Token #${t.tokenNumber} has no language preference - skipping`)
          continue
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

      if (!nextToken) {
        console.log('No tokens match your assigned services and languages')
        return res.json({ message: 'No tokens match your assigned services and languages right now' })
      }
    }

    // Assign the selected token to the officer
    console.log(`Assigning token #${nextToken.tokenNumber} to officer ${officer.name}`)

    const updatedToken = await prisma.token.update({
      where: { id: nextToken.id },
      data: {
        status: 'in_service',
        assignedTo: officerId,
        counterNumber: officer.counterNumber,
        calledAt: new Date(),
        startedAt: new Date(),
      },
      include: { customer: true, officer: true },
    })

    await prisma.officer.update({ where: { id: officerId }, data: { status: 'serving' } })

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

    const hasAny = (a: string[], b: string[]) => a.some(x => b.includes(x))

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

    const token = await prisma.token.findUnique({ where: { id: tokenId } })
    if (!token) return res.status(404).json({ error: 'Token not found' })

    // Call token to counter (works for waiting or any status except completed)
    if (token.status === 'completed') {
      return res.status(400).json({ error: 'Cannot call completed token' })
    }

    const called = await prisma.token.update({
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
    broadcast({ type: 'TOKEN_CALLED', data: called })

    res.json({ success: true, token: called })
  } catch (error) {
    console.error('Call token error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: 'Failed to call token', details: errorMessage })
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

    // Create ServiceCase (tracking) and initial update, and print SMS to console
    try {
      let completedRef: string | null = null
      // Generate reference number: YYYY-MM-DD/OutletName/TokenNumber for uniqueness
      const refDate = new Date().toISOString().slice(0, 10)
      const outletName = (token.outlet?.name || 'Outlet').replace(/\//g, '-')
      const refNumber = `${refDate}/${outletName}/${token.tokenNumber}`

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
            status: 'open',
          }
        })

        await (prisma as any).serviceCaseUpdate.create({
          data: {
            caseId: serviceCase.id,
            actorRole: 'officer',
            actorId: officerId,
            status: 'submitted',
            note: 'Service submitted for further processing',
          }
        })
      }
      completedRef = serviceCase.refNumber

      // "SMS" via console output with full tracking URL
      try {
        const services = Array.isArray((token as any).serviceTypes) ? (token as any).serviceTypes.join(', ') : ''
        const officerName = (token as any)?.officer?.name || 'Officer'
        const outlet = token.outlet?.name || ''

        // Build absolute tracking URL using same logic as below
        const trackRef = `/service/status?ref=${encodeURIComponent(serviceCase.refNumber)}`
        const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
        let baseUrl = origins[0] || ''

        // Always prioritize Vercel URLs if available
        const vercelUrl = origins.find(o => o.includes('vercel.app') || (o.includes('https://') && !o.includes('localhost')))
        if (vercelUrl) {
          baseUrl = vercelUrl
        } else if (process.env.NODE_ENV === 'production') {
          // In production, prefer any HTTPS URL over localhost
          baseUrl = origins.find(o => o.startsWith('https://') && !o.includes('localhost')) || baseUrl
        }

        const trackUrl = baseUrl ? `${baseUrl}${trackRef}` : trackRef
        const msg = `Ref: ${serviceCase.refNumber} | Officer: ${officerName} | Outlet: ${outlet} | Services: ${services}. Track: ${trackUrl}`
        console.log(`[SMS][${token.customer.mobileNumber}] ${msg}`)
      } catch (e) {
        console.log('SMS print failed:', e)
      }
    } catch (err) {
      console.error('ServiceCase creation error:', err)
    }

    // Include the generated reference number and absolute tracking URL in response
    try {
      const caseRecord = await (prisma as any).serviceCase.findFirst({ where: { tokenId: token.id } })
      const refNumber = caseRecord?.refNumber || null
      const trackRef = refNumber ? `/service/status?ref=${encodeURIComponent(refNumber)}` : null
      // Build absolute URL for SMS so it becomes clickable
      const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
      let baseUrl = origins[0] || ''

      // Always prioritize Vercel URLs if available
      const vercelUrl = origins.find(o => o.includes('vercel.app') || (o.includes('https://') && !o.includes('localhost')))
      if (vercelUrl) {
        baseUrl = vercelUrl
      } else if (process.env.NODE_ENV === 'production') {
        // In production, prefer any HTTPS URL over localhost
        baseUrl = origins.find(o => o.startsWith('https://') && !o.includes('localhost')) || baseUrl
      }

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

// Officer-auth: Get a service case by refNumber only if owned by this officer
router.get("/service-case/:refNumber", async (req, res) => {
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
    const { refNumber } = req.params as { refNumber: string }
    if (!refNumber) return res.status(400).json({ error: 'refNumber is required' })

    const sc: any = await (prisma as any).serviceCase.findUnique({
      where: { refNumber },
      include: {
        outlet: true,
        officer: true,
        customer: true,
        token: { select: { preferredLanguages: true } },
        updates: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!sc) return res.status(404).json({ error: 'Reference not found' })
    if (sc.officerId !== officerId) {
      return res.status(403).json({ error: 'Not authorized to view this service case' })
    }

    return res.json({
      refNumber: sc.refNumber,
      status: sc.status,
      outlet: { id: sc.outletId, name: sc.outlet.name, location: sc.outlet.location },
      serviceTypes: sc.serviceTypes,
      createdAt: sc.createdAt,
      completedAt: sc.completedAt,
      preferredLanguage: Array.isArray(sc?.token?.preferredLanguages) && sc.token.preferredLanguages.length > 0
        ? sc.token.preferredLanguages[0]
        : null,
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

export default router
