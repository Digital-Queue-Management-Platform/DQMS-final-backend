import { Router, Request, Response } from "express"
import { prisma, broadcast, priorityBroadcast } from "../server"
import * as jwt from "jsonwebtoken"
import { randomUUID } from "crypto"
import otpService from "../services/otpService"
import emailService from "../services/emailService"
import sltSmsService from "../services/sltSmsService"
import { getFrontendBaseUrl } from "../utils/urlHelper"
import { isValidSLMobile, isValidEmail, isValidName } from "../utils/validators"

import { announceToIpSpeaker } from "../utils/announcer"

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret"

// Helper to write an audit log entry (fire-and-forget, non-blocking)
const auditLog = (
  teleshopManagerId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: object
) => {
  (prisma as any).teleshopManagerAuditLog
    .create({
      data: {
        teleshopManagerId,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        details: details ?? null,
      },
    })
    .catch((err: any) => console.error("Audit log error:", err))
}
const JWT_EXPIRES = process.env.JWT_EXPIRES || undefined

// Request OTP for teleshop manager login
router.post("/request-otp", async (req, res) => {
  try {
    const { mobileNumber } = req.body

    if (!mobileNumber) {
      return res.status(400).json({ error: "Mobile number is required" })
    }

    // Check if teleshop manager exists
    const teleshopManager = await prisma.teleshopManager.findFirst({
      where: { mobileNumber, isActive: true },
      select: { id: true, name: true }
    })

    if (!teleshopManager) {
      return res.status(404).json({ error: "Teleshop Manager not found or inactive" })
    }

    // Generate and send OTP
    const result = await otpService.generateOTP(mobileNumber, 'teleshop_manager', teleshopManager.name)

    if (!result.success) {
      return res.status(500).json({ error: result.message })
    }

    res.json({
      success: true,
      message: result.message,
      managerName: teleshopManager.name
    })
  } catch (error) {
    console.error("Request OTP error:", error)
    res.status(500).json({ error: "Failed to send OTP" })
  }
})

// Teleshop Manager authentication using mobile number and OTP
router.post("/login", async (req, res) => {
  try {
    const { mobileNumber, otpCode } = req.body

    if (!mobileNumber || !otpCode) {
      return res.status(400).json({ error: "Mobile number and OTP code are required" })
    }

    // Verify OTP
    const verifyResult = await otpService.verifyOTP(mobileNumber, otpCode, 'teleshop_manager')

    if (!verifyResult.success) {
      return res.status(401).json({ error: verifyResult.message })
    }

    // Find teleshop manager by mobile number
    const teleshopManager = await prisma.teleshopManager.findFirst({
      where: {
        mobileNumber: mobileNumber,
        isActive: true
      },
      include: {
        region: true,
        branch: {
          select: {
            id: true,
            name: true,
            location: true
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

    auditLog(teleshopManager.id, "LOGIN", "teleshop_manager", teleshopManager.id, {
      mobileNumber: teleshopManager.mobileNumber,
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
        branchId: teleshopManager.branchId,
        branchName: teleshopManager.branch?.name || null
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
router.post("/logout", async (req: any, res) => {
  try {
    // Log before clearing cookie
    const authHeader = req.headers.authorization
    let managerId: string | null = null
    try {
      const rawToken = req.cookies?.dq_teleshop_manager_jwt ||
        (authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null)
      if (rawToken) {
        const payload: any = (jwt as any).verify(rawToken, JWT_SECRET)
        managerId = payload?.teleshopManagerId ?? null
      }
    } catch (_) { }

    res.clearCookie("dq_teleshop_manager_jwt", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    })

    if (managerId) {
      auditLog(managerId, "LOGOUT", "teleshop_manager", managerId)
    }

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

// Check if device has been configured (no authentication required for device polling)
router.get("/check-device-config/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params
    
    if (!deviceId) {
      return res.status(400).json({ error: "Device ID is required" })
    }

    console.log("Checking device configuration for:", deviceId)

    // Search all outlets for this device in their displaySettings
    const outlets = await prisma.outlet.findMany({
      select: { id: true, name: true, location: true, displaySettings: true }
    })

    console.log("Found outlets:", outlets.length)
    
    for (const outlet of outlets) {
      const displaySettings = outlet.displaySettings as any
      const linkedDevices = displaySettings?.linkedDevices || []
      
      console.log(`Outlet ${outlet.name} has ${linkedDevices.length} linked devices:`, 
        linkedDevices.map((d: any) => ({ deviceId: d.deviceId, deviceName: d.deviceName, isActive: d.isActive })))
      
      const configuredDevice = linkedDevices.find((device: any) => 
        device.deviceId === deviceId && device.isActive
      )

      if (configuredDevice) {
        console.log("Found configured device:", configuredDevice)
        // Device found and configured
        return res.json({
          isConfigured: true,
          outletId: outlet.id,
          outletName: outlet.name,
          baseUrl: process.env.BASE_URL || (process.env.NODE_ENV === 'development' 
            ? "http://10.191.253.58:3001/" // Real device: use your computer's IP
            : `${req.protocol}://${req.get('host')}/`), // Use current request host
          device: {
            deviceId: configuredDevice.deviceId,
            deviceName: configuredDevice.deviceName,
            configuredAt: configuredDevice.configuredAt,
            isActive: configuredDevice.isActive,
            lastSeen: configuredDevice.lastSeen || null
          }
        })
      }
    }

    console.log("No configured device found for ID:", deviceId)

    // Device not found or not configured
    res.json({
      isConfigured: false,
      message: "Device not configured yet"
    })

  } catch (error) {
    console.error("Check device config error:", error)
    res.status(500).json({ error: "Failed to check device configuration" })
  }
})

// Device heartbeat endpoint (public - no auth required)
router.put('/device-heartbeat/:deviceId', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params
    const { timestamp } = req.body

    if (!deviceId) {
      return res.status(400).json({ error: "Device ID is required" })
    }

    console.log(`Device heartbeat received from: ${deviceId}`)

    // Find the outlet with this device
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true }
    })

    for (const outlet of outlets) {
      const displaySettings = outlet.displaySettings as any || {}
      const linkedDevices = displaySettings.linkedDevices || []
      
      // Find the device in this outlet
      const deviceIndex = linkedDevices.findIndex((device: any) => device.deviceId === deviceId)
      
      if (deviceIndex !== -1) {
        // Update device's lastSeen timestamp
        linkedDevices[deviceIndex].lastSeen = new Date().toISOString()
        
        const updatedDisplaySettings = {
          ...displaySettings,
          linkedDevices: linkedDevices
        }

        await prisma.outlet.update({
          where: { id: outlet.id },
          data: { displaySettings: updatedDisplaySettings }
        })

        console.log(`Updated lastSeen for device ${deviceId} in outlet ${outlet.name}`)
        
        return res.json({
          success: true,
          message: "Heartbeat recorded",
          outletId: outlet.id,
          outletName: outlet.name,
          timestamp: linkedDevices[deviceIndex].lastSeen
        })
      }
    }

    // Device not found
    res.status(404).json({ 
      success: false,
      error: "Device not found or not configured" 
    })

  } catch (error) {
    console.error("Device heartbeat error:", error)
    res.status(500).json({ error: "Failed to record device heartbeat" })
  }
})

// Debug endpoint to check all device configurations (public for debugging)
router.get('/debug/device-configs', async (req: Request, res: Response) => {
  try {
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        displaySettings: true
      }
    })

    const deviceConfigs = outlets.map(outlet => {
      const displaySettings = outlet.displaySettings as any || {}
      const linkedDevices = displaySettings.linkedDevices || []
      
      return {
        outletId: outlet.id,
        outletName: outlet.name,
        deviceCount: linkedDevices.length,
        devices: linkedDevices.map((device: any) => ({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          isActive: device.isActive,
          configuredAt: device.configuredAt,
          lastSeen: device.lastSeen || null
        }))
      }
    })

    res.json({
      success: true,
      totalOutlets: outlets.length,
      deviceConfigurations: deviceConfigs
    })

  } catch (error) {
    console.error("Debug device configs error:", error)
    res.status(500).json({ error: "Failed to fetch device configurations" })
  }
})

// APK Status Check - Quick endpoint for Android TV APK to verify its status
router.get("/apk-status/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params
    
    if (!deviceId) {
      return res.status(400).json({ error: "Device ID is required" })
    }

    console.log("APK status check for device:", deviceId)

    // Quick check across all outlets
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: { id: true, name: true, displaySettings: true }
    })

    for (const outlet of outlets) {
      const displaySettings = outlet.displaySettings as any || {}
      const linkedDevices = displaySettings.linkedDevices || []
      
      const device = linkedDevices.find((d: any) => d.deviceId === deviceId && d.isActive)
      
      if (device) {
        // Device is still configured and active
        return res.json({
          status: "ACTIVE",
          shouldReset: false,
          outletId: outlet.id,
          outletName: outlet.name,
          deviceName: device.deviceName,
          lastCheck: new Date().toISOString()
        })
      }
    }

    // Device not found or removed - APK should reset
    console.log("APK should reset - device not found:", deviceId)
    return res.json({
      status: "REMOVED",
      shouldReset: true,
      message: "Device has been removed - please return to QR setup",
      lastCheck: new Date().toISOString()
    })

  } catch (error) {
    console.error("APK status check error:", error)
    res.status(500).json({ 
      status: "ERROR",
      shouldReset: true, // On error, APK should reset to be safe
      error: "Failed to check device status" 
    })
  }
})

// Fast heartbeat - immediate device status check (optimized for APK speed)
router.get("/fast-heartbeat/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params
    
    if (!deviceId) {
      return res.status(400).json({ status: "ERROR", shouldReset: true })
    }

    // Fast check - only look in active outlets with minimal data
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: { displaySettings: true }
    })

    for (const outlet of outlets) {
      const displaySettings = outlet.displaySettings as any || {}
      const linkedDevices = displaySettings.linkedDevices || []
      
      const device = linkedDevices.find((d: any) => d.deviceId === deviceId && d.isActive)
      
      if (device) {
        return res.json({ status: "ACTIVE", shouldReset: false })
      }
    }

    // Device not found = should reset immediately  
    return res.json({ status: "REMOVED", shouldReset: true })

  } catch (error) {
    return res.json({ status: "ERROR", shouldReset: true })
  }
})

// ========== HTTP POLLING ENDPOINTS FOR APK (Production Reliable) ==========
// These endpoints are PUBLIC (no authentication) for APK polling

// Get recent audio events for APK HTTP polling fallback
router.get('/audio-events/:outletId', async (req: Request, res: Response) => {
  try {
    const { outletId } = req.params
    const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 30000) // Last 30 seconds
    
    // Get recent audio events for this outlet from global memory
    const recentEvents = (global.recentAudioEvents || [])
      .filter((event: any) => 
        event.outletId === outletId && 
        new Date(event.timestamp) > since
      )
    
    console.log(`[APK_POLLING] Outlet ${outletId} polled for events since ${since.toISOString()}, found ${recentEvents.length} events`)
    
    res.json({
      success: true,
      events: recentEvents,
      serverTime: new Date().toISOString(),
      count: recentEvents.length
    })
    
  } catch (error: any) {
    console.error('[APK_POLLING] Get events error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Acknowledge processed audio events (cleanup)
router.post('/audio-events/:outletId/ack', async (req: Request, res: Response) => {
  try {
    const { eventIds } = req.body
    
    if (eventIds && Array.isArray(eventIds)) {
      const initialCount = (global.recentAudioEvents || []).length
      global.recentAudioEvents = (global.recentAudioEvents || [])
        .filter((event: any) => !eventIds.includes(event.id))
      
      const removedCount = initialCount - global.recentAudioEvents.length
      console.log(`[APK_POLLING] Acknowledged ${removedCount} events, ${global.recentAudioEvents.length} remaining`)
    }
    
    res.json({ success: true })
    
  } catch (error: any) {
    console.error('[APK_POLLING] Ack error:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

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
        branch: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      }
    })

    res.json({ teleshopManager: profile })
  } catch (error) {
    console.error("Teleshop Manager profile fetch error:", error)
    res.status(500).json({ error: "Failed to fetch profile" })
  }
})

// Trigger a test sound on the outlet display via WebSocket
router.post("/test-sound", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { type, lang, customText, chimeVolume, voiceVolume } = req.body

    if (!teleshopManager.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }

    // Check for IP Speaker config in outlet settings
    const outlet = await prisma.outlet.findUnique({
      where: { id: teleshopManager.branchId },
      select: { displaySettings: true }
    })

    const settings = (outlet?.displaySettings as any) || {}
    const useIPSpeaker = settings.useIPSpeaker
    const ipConfig = settings.ipSpeakerConfig

    // 1. Broadcast to all WebSocket clients (for browser displays)
    broadcast({
      type: "TEST_SOUND",
      data: {
        outletId: teleshopManager.branchId,
        testType: type,
        lang: lang || 'en',
        customText: customText || null,
        chimeVolume: chimeVolume || 100, // Default to MAX (100%) if not provided
        voiceVolume: voiceVolume || 300  // Default to MAX (300%) if not provided
      }
    })

    // 2. Store audio event for HTTP polling fallback (for APK when WebSocket fails)
    const audioEvent = {
      id: Date.now().toString(),
      outletId: teleshopManager.branchId,
      type: "TEST_SOUND",
      testType: type,
      lang: lang || 'en',
      customText: customText || null,
      chimeVolume: chimeVolume || 100,
      voiceVolume: voiceVolume || 300,
      timestamp: new Date().toISOString()
    }
    
    // Store in global memory for APK polling (simple reliable fallback)
    if (!global.recentAudioEvents) {
      global.recentAudioEvents = []
    }
    global.recentAudioEvents.push(audioEvent)
    
    // Keep only last 20 events (prevent memory bloat)
    if (global.recentAudioEvents.length > 20) {
      global.recentAudioEvents = global.recentAudioEvents.slice(-20)
    }
    
    console.log(`[HTTP_FALLBACK] Audio event stored for APK polling: ${audioEvent.id} (outlet: ${audioEvent.outletId})`)

    // 3. If IP Speaker is enabled and this is a voice announcement, trigger hardware cast
    if (type === 'voice') {
      const textToSpeak = customText || (lang === 'si' 
        ? "මෙය ස්පීකර් පරීක්ෂණ නිවේදනයකි." 
        : lang === 'ta' 
          ? "இது ஒரு ஒலிபெருக்கி சோதனை அறிவிப்பு." 
          : "This is a speaker test announcement.")
      
      announceToIpSpeaker(teleshopManager.branchId, textToSpeak, lang || 'en')
    }

    res.json({ success: true, message: "Test sound triggered" })
  } catch (error) {
    console.error("Test sound error:", error)
    res.status(500).json({ error: "Failed to trigger test sound" })
  }
})

// Get kiosk settings for teleshop manager's outlet
router.get("/kiosk-settings", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    if (!teleshopManager.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }

    const outlet = await prisma.outlet.findUnique({
      where: { id: teleshopManager.branchId },
      select: {
        id: true,
        name: true,
        location: true,
        kioskPassword: true
      }
    })

    if (!outlet) {
      return res.status(404).json({ error: "Outlet not found" })
    }

    res.json({ success: true, outlet })
  } catch (error) {
    console.error("Get kiosk settings error:", error)
    res.status(500).json({ error: "Failed to fetch kiosk settings" })
  }
})

// Set/Update kiosk password for teleshop manager's outlet
router.post("/kiosk-settings", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { kioskPassword } = req.body

    if (!teleshopManager.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }

    if (!kioskPassword || kioskPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long" })
    }

    const outlet = await prisma.outlet.update({
      where: { id: teleshopManager.branchId },
      data: { kioskPassword }
    })

    auditLog(teleshopManager.id, "KIOSK_PASSWORD_UPDATED", "outlet", outlet.id, {
      outletName: outlet.name,
    })

    res.json({
      success: true,
      message: "Kiosk password updated successfully",
      outlet: {
        id: outlet.id,
        name: outlet.name,
        kioskPassword: outlet.kioskPassword
      }
    })
  } catch (error) {
    console.error("Set kiosk password error:", error)
    res.status(500).json({ error: "Failed to update kiosk password" })
  }
})

// Get officers managed by teleshop manager
router.get("/officers", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    // Check if teleshop manager has an assigned branch
    if (!teleshopManager.branchId) {
      return res.json({ success: true, officers: [], endpoint: "teleshop-manager-officers-v2" })
    }

    const officers = await prisma.officer.findMany({
      where: {
        outletId: teleshopManager.branchId
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
      let status = officer.status || 'offline' // Use actual officer status
      if (activeBreak) {
        status = 'on_break' // Override to on_break if there's an active break
      }

      return {
        id: officer.id,
        name: officer.name,
        mobileNumber: officer.mobileNumber,
        counterNumber: officer.counterNumber,
        status,
        outlet: officer.outlet,
        assignedServices: officer.assignedServices || [],
        totalBreaks: officer.BreakLog.length,
        totalMinutes,
        activeBreak: activeBreak ? {
          id: activeBreak.id,
          startTime: activeBreak.startedAt
        } : null,
        email: officer.email,
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
    const { name, mobileNumber, outletId, counterNumber, isTraining, languages, assignedServices, email } = req.body

    if (!name || !mobileNumber || !outletId) {
      return res.status(400).json({ error: "Name, mobile number, and outlet ID are required" })
    }
    if (!isValidName(name)) return res.status(400).json({ error: "Name must be between 2 and 100 characters" })
    if (!isValidSLMobile(mobileNumber)) return res.status(400).json({ error: "Invalid mobile number. Must be a valid Sri Lankan number (e.g. 0771234567)" })
    if (req.body.email && !isValidEmail(req.body.email)) return res.status(400).json({ error: "Invalid email address format" })

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

    // Check for duplicate mobile number across ALL officers system-wide
    const duplicate = await prisma.officer.findUnique({ where: { mobileNumber } })
    if (duplicate) {
      return res.status(409).json({ error: `An officer with mobile number ${mobileNumber} is already registered in the system` })
    }

    // Create the officer
    const officerData: any = {
      name,
      mobileNumber,
      email: email || null,
      outletId
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



    const officer = await prisma.officer.create({
      data: officerData,
      include: {
        outlet: true
      }
    })

    // Send notifications
    const loginUrl = `${getFrontendBaseUrl()}/officer/login`

    // Email (if email is provided in body)
    if (req.body.email) {
      emailService.sendStaffWelcomeEmail({
        name,
        email: req.body.email,
        mobileNumber,
        role: "Customer Service Officer",
        outletName: officer.outlet?.name,
        loginUrl
      }).catch(err => console.error("Officer welcome email failed:", err))
    }

    // SMS
    sltSmsService.sendStaffWelcomeSMS(mobileNumber, {
      name,
      role: "Customer Service Officer",
      loginUrl
    }).catch(err => console.error("Officer welcome SMS failed:", err))

    auditLog(teleshopManager.id, "OFFICER_CREATED", "officer", officer.id, {
      name: officer.name,
      mobileNumber: officer.mobileNumber,
      outletId: officer.outletId,
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
    const { name, counterNumber, assignedServices, isTraining, languages, email } = req.body

    // Verify officer belongs to this teleshop manager's outlet
    if (!teleshopManager.branchId) {
      return res.status(403).json({ error: "You are not assigned to any branch" })
    }

    const existingOfficer = await prisma.officer.findFirst({
      where: {
        id: officerId,
        outletId: teleshopManager.branchId
      }
    })

    if (!existingOfficer) {
      return res.status(403).json({ error: "Officer not found or not at your assigned outlet" })
    }

    // Prepare update data
    const updateData: any = {}

    if (name !== undefined) updateData.name = name
    if (counterNumber !== undefined) updateData.counterNumber = counterNumber
    if (isTraining !== undefined) updateData.isTraining = isTraining
    if (assignedServices !== undefined) updateData.assignedServices = assignedServices
    if (languages !== undefined) updateData.languages = languages
    if (email !== undefined) updateData.email = email || null

    console.log("Updating officer with data:", JSON.stringify(updateData, null, 2))

    const updatedOfficer = await prisma.officer.update({
      where: { id: officerId },
      data: updateData,
      include: {
        outlet: true
      }
    })

    auditLog(teleshopManager.id, "OFFICER_UPDATED", "officer", officerId, updateData)

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

// Assign officer to counter
router.patch("/officers/:officerId/assign-counter", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { officerId } = req.params
    const { counterNumber } = req.body

    // Verify officer belongs to this teleshop manager's outlet
    if (!teleshopManager.branchId) {
      return res.status(403).json({ error: "You are not assigned to any branch" })
    }

    const officer = await prisma.officer.findFirst({
      where: {
        id: officerId,
        outletId: teleshopManager.branchId
      },
      include: { outlet: true }
    })

    if (!officer) {
      return res.status(403).json({ error: "Officer not found or not at your assigned outlet" })
    }

    // If assigning a counter (not null), validate it
    if (counterNumber !== null && counterNumber !== undefined) {
      const parsed = Number(counterNumber)

      // Validate counter number is valid
      if (!Number.isInteger(parsed) || parsed < 1) {
        return res.status(400).json({ error: "Counter number must be a positive integer" })
      }

      // Check outlet counter capacity
      if (officer.outlet.counterCount && parsed > officer.outlet.counterCount) {
        return res.status(400).json({
          error: `Counter #${parsed} exceeds outlet capacity of ${officer.outlet.counterCount} counters`
        })
      }

      // Check if counter is already assigned to another officer
      const existingAssignment = await prisma.officer.findFirst({
        where: {
          outletId: officer.outletId,
          counterNumber: parsed,
          id: { not: officerId }
        }
      })

      if (existingAssignment) {
        return res.status(400).json({
          error: `Counter #${parsed} is already assigned to ${existingAssignment.name}`
        })
      }
    }

    // Update officer counter assignment
    const updatedOfficer = await prisma.officer.update({
      where: { id: officerId },
      data: { counterNumber: counterNumber === null ? null : Number(counterNumber) },
      include: {
        outlet: true
      }
    })

    // Broadcast update
    broadcast({
      type: "OFFICER_UPDATED",
      data: { officerId, counterNumber: updatedOfficer.counterNumber }
    })

    auditLog(teleshopManager.id, "OFFICER_COUNTER_ASSIGNED", "officer", officerId, {
      counterNumber: updatedOfficer.counterNumber,
      officerName: updatedOfficer.name,
    })

    res.json({ success: true, officer: updatedOfficer })
  } catch (error: any) {
    console.error("Assign counter error:", error)
    res.status(500).json({ error: "Failed to assign counter" })
  }
})

// Delete officer managed by teleshop manager
router.delete("/officers/:officerId", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { officerId } = req.params

    // Verify officer belongs to this teleshop manager's outlet
    if (!teleshopManager.branchId) {
      return res.status(403).json({ error: "You are not assigned to any branch" })
    }

    const existingOfficer = await prisma.officer.findFirst({
      where: {
        id: officerId,
        outletId: teleshopManager.branchId
      }
    })

    if (!existingOfficer) {
      return res.status(404).json({ error: "Officer not found or not at your assigned outlet" })
    }

    // Delete the officer
    await prisma.officer.delete({
      where: { id: officerId }
    })

    auditLog(teleshopManager.id, "OFFICER_DELETED", "officer", officerId, {
      name: existingOfficer.name,
      mobileNumber: existingOfficer.mobileNumber,
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
    if (!teleshopManager.branchId) {
      return res.json({
        timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        teleshopStats: {
          totalOfficers: 0,
          officersOnBreak: 0,
          totalBreaksToday: 0,
          totalBreakMinutes: 0,
          avgBreakDuration: 0
        },
        officers: []
      })
    }

    const officers = await prisma.officer.findMany({
      where: {
        outletId: teleshopManager.branchId
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
        email: officer.email,
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

    // Verify officer belongs to this teleshop manager's outlet
    if (!teleshopManager.branchId) {
      return res.status(403).json({ error: "You are not assigned to any branch" })
    }

    const officer = await prisma.officer.findFirst({
      where: {
        id: officerId,
        outletId: teleshopManager.branchId
      },
      include: {
        outlet: true
      }
    })

    if (!officer) {
      return res.status(403).json({ error: "Officer not found or not at your assigned outlet" })
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
    const where: any = {}

    // Filter by teleshop manager's assigned outlet
    if (teleshopManager.branchId) {
      where.outletId = teleshopManager.branchId
    } else {
      // If no branch assigned, return empty results
      return res.json({
        services: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        },
        stats: {
          totalServices: 0,
          todayServices: 0,
          thisWeekServices: 0,
          avgDuration: 0
        }
      })
    }

    if (officerId) {
      where.officerId = officerId
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

    // Build base where clause for outlet filtering (used for stats)
    // Get all feedback from tokens in this teleshop manager's outlet
    const baseWhere: any = {}

    // Filter by outlet if teleshop manager has a branchId assigned
    if (teleshopManager.branchId) {
      // Get all tokens from this outlet
      const outletTokens = await prisma.token.findMany({
        where: { outletId: teleshopManager.branchId },
        select: { id: true }
      })
      const tokenIds = outletTokens.map(t => t.id)

      // Filter feedback by these token IDs
      if (tokenIds.length > 0) {
        baseWhere.tokenId = { in: tokenIds }
      } else {
        // No tokens in this outlet, return empty
        baseWhere.id = 'no-match' // This will return no results
      }
    } else {
      // No branch assigned, return empty results
      baseWhere.id = 'no-match' // This will return no results
    }

    // Build filtered where clause (includes user filters)
    const where: any = { ...baseWhere }

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

    // Calculate statistics using baseWhere (unfiltered by user selections)
    const stats = {
      totalFeedback: await prisma.feedback.count({ where: baseWhere }),
      unresolvedFeedback: await prisma.feedback.count({
        where: {
          ...baseWhere,
          isResolved: false
        }
      }),
      resolvedFeedback: await prisma.feedback.count({
        where: {
          ...baseWhere,
          isResolved: true
        }
      }),
      todayFeedback: await prisma.feedback.count({
        where: {
          ...baseWhere,
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

    // Verify feedback belongs to this teleshop manager's outlet
    const existingFeedback = await prisma.feedback.findFirst({
      where: {
        id: feedbackId
      },
      include: {
        token: {
          select: {
            outletId: true
          }
        }
      }
    })

    if (!existingFeedback) {
      return res.status(404).json({ error: "Feedback not found" })
    }

    // Check if feedback is from teleshop manager's outlet
    if (!teleshopManager.branchId || existingFeedback.token.outletId !== teleshopManager.branchId) {
      return res.status(403).json({ error: "Feedback not found or not from your outlet" })
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

    auditLog(teleshopManager.id, "FEEDBACK_RESOLVED", "feedback", feedbackId, {
      resolutionComment: resolutionComment || "Resolved by teleshop manager",
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

// Get outlet display settings
router.get("/display-settings", async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    if (!tm.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }

    const outlet = await prisma.outlet.findUnique({
      where: { id: tm.branchId },
      select: { displaySettings: true }
    })

    res.json({ success: true, settings: outlet?.displaySettings || null })
  } catch (error) {
    console.error("Get display settings error:", error)
    res.status(500).json({ error: "Failed to fetch display settings" })
  }
})

// Update outlet display settings with validation
router.post("/display-settings", async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    if (!tm.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }

    const { settings } = req.body
    if (!settings) {
      return res.status(400).json({ error: "Settings are required" })
    }

    // Validate display settings structure
    if (settings.linkedDevices && Array.isArray(settings.linkedDevices)) {
      for (const device of settings.linkedDevices) {
        // Validate required device fields
        if (!device.deviceId || !device.deviceName) {
          return res.status(400).json({ 
            error: "Each device must have deviceId and deviceName" 
          })
        }
        
        // Ensure proper device structure
        if (!device.id) {
          device.id = randomUUID() // Generate UUID if missing
        }
        if (!device.configuredAt) {
          device.configuredAt = new Date().toISOString()
        }
        if (!device.configuredBy) {
          device.configuredBy = tm.id
        }
        if (device.isActive === undefined) {
          device.isActive = true
        }
        if (!device.lastSeen) {
          device.lastSeen = new Date().toISOString()
        }
        if (!device.macAddress) {
          device.macAddress = 'Unknown'
        }
      }
    }

    const updated = await prisma.outlet.update({
      where: { id: tm.branchId },
      data: { displaySettings: settings }
    })

    auditLog(tm.id, "DISPLAY_SETTINGS_UPDATED", "outlet", updated.id, {
      settings: settings,
      method: 'MANUAL_SETUP'
    })

    // Broadcast settings update to connected devices
    broadcast({
      type: "DISPLAY_SETTINGS_UPDATED",
      data: {
        outletId: tm.branchId,
        updatedBy: tm.id,
        settings: settings
      }
    })

    res.json({ success: true, settings: updated.displaySettings })
  } catch (error) {
    console.error("Update display settings error:", error)
    res.status(500).json({ error: "Failed to update display settings" })
  }
})

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

    auditLog(tm.id, "SERVICE_CASE_UPDATED", "service_case", sc.id, {
      refNumber,
      note,
      status: status || null,
    })

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

    auditLog(tm.id, "SERVICE_CASE_COMPLETED", "service_case", sc.id, {
      refNumber,
      note: note || 'Marked completed',
    })

    res.json({ success: true, case: updated })
  } catch (e) {
    console.error('Teleshop manager service-case complete error:', e)
    res.status(500).json({ error: 'Failed to complete case' })
  }
})

// Get comprehensive service case details (Teleshop Manager)
router.get('/service-case/*', async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    const refNumber = decodeURIComponent((req.params as any)[0])

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
        updates: { orderBy: { createdAt: 'asc' } }
      }
    })

    if (!sc) return res.status(404).json({ error: 'Reference not found' })

    // Authorization: case must belong to teleshop manager's outlet
    if (tm.branchId && sc.outletId !== tm.branchId) {
      return res.status(403).json({ error: 'Access denied: case not from your assigned outlet' })
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

    const token = sc.token
    const feedback = token?.feedback || null

    // Compute time spans
    const waitDurationMs = token?.calledAt && token?.createdAt
      ? new Date(token.calledAt).getTime() - new Date(token.createdAt).getTime()
      : null
    const serviceDurationMs = token?.completedAt && token?.startedAt
      ? new Date(token.completedAt).getTime() - new Date(token.startedAt).getTime()
      : null
    const totalDurationMs = token?.completedAt && token?.createdAt
      ? new Date(token.completedAt).getTime() - new Date(token.createdAt).getTime()
      : null

    res.json({
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
      token: token ? {
        id: token.id,
        tokenNumber: token.tokenNumber,
        isPriority: token.isPriority,
        isTransferred: token.isTransferred,
        preferredLanguages: token.preferredLanguages,
        accountRef: token.accountRef || null,
        sltTelephoneNumber: token.sltTelephoneNumber || null,
        billPaymentIntent: token.billPaymentIntent || null,
        billPaymentAmount: token.billPaymentAmount ?? null,
        billPaymentMethod: token.billPaymentMethod || null,
        createdAt: token.createdAt,
        calledAt: token.calledAt || null,
        startedAt: token.startedAt || null,
        completedAt: token.completedAt || null,
      } : null,
      timeSpans: {
        waitDurationMs,
        serviceDurationMs,
        totalDurationMs,
      },
      transferLogs: (token?.transferLogs || []).map((tl: any) => ({
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
      updates: (sc.updates || []).map((u: any) => ({
        id: u.id,
        actorRole: u.actorRole,
        actorId: u.actorId,
        status: u.status,
        note: u.note,
        createdAt: u.createdAt,
      }))
    })
  } catch (e) {
    console.error('Teleshop manager service-case get error:', e)
    res.status(500).json({ error: 'Failed to fetch service case' })
  }
})

// Get alerts for Teleshop Manager (specifically 3-star feedback alerts)
router.get("/alerts", async (req: any, res) => {
  try {
    const { isRead, outletId } = req.query
    const teleshopManager = req.teleshopManager

    // Get teleshop manager's outlets to filter alerts
    const outlets = teleshopManager.branchId
      ? await prisma.outlet.findMany({
        where: {
          id: teleshopManager.branchId
        },
        select: { id: true }
      })
      : []

    const outletIds = outlets.map(outlet => outlet.id)

    const where: any = {
      type: "moderate_feedback", // Only 3-star feedback alerts for Teleshop Manager (stored as moderate_feedback)
    }

    if (isRead !== undefined) {
      where.isRead = isRead === "true"
    }

    // Get all alerts
    let alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    // Filter alerts to only include those from teleshop manager's outlets
    if (alerts.length > 0) {
      const tokenIds = alerts.map((a) => a.relatedEntity).filter((x): x is string => !!x)
      if (tokenIds.length > 0) {
        const tokens = await prisma.token.findMany({
          where: {
            id: { in: tokenIds },
            outletId: { in: outletIds }
          },
          include: {
            customer: { select: { name: true } },
            outlet: { select: { name: true } }
          }
        })

        const validTokenIds = new Set(tokens.map((t) => t.id))
        alerts = alerts.filter((a) => a.relatedEntity && validTokenIds.has(a.relatedEntity))

        // Enrich alerts with outlet and customer information
        const tokenMap = new Map(tokens.map(t => [t.id, {
          outletId: t.outletId,
          outletName: t.outlet.name,
          customerName: t.customer?.name
        }]))

        alerts = alerts.map(alert => ({
          ...alert,
          outletInfo: alert.relatedEntity ? tokenMap.get(alert.relatedEntity) : null
        }))
      } else {
        alerts = []
      }
    }

    // If specific outletId filter is requested
    if (outletId && alerts.length > 0) {
      alerts = alerts.filter((alert: any) =>
        alert.outletInfo && alert.outletInfo.outletId === outletId
      )
    }

    res.json(alerts)
  } catch (error) {
    console.error("Teleshop Manager alerts fetch error:", error)
    res.status(500).json({ error: "Failed to fetch alerts" })
  }
})

// Mark alert as read for Teleshop Manager
router.patch("/alerts/:alertId/read", async (req: any, res) => {
  try {
    const { alertId } = req.params
    const teleshopManager = req.teleshopManager

    // Verify the alert belongs to teleshop manager's outlets
    const alert = await prisma.alert.findUnique({
      where: { id: alertId }
    })

    if (!alert) {
      return res.status(404).json({ error: "Alert not found" })
    }

    // Get teleshop manager's outlets to verify ownership
    const outlets = teleshopManager.branchId
      ? await prisma.outlet.findMany({
        where: {
          id: teleshopManager.branchId
        },
        select: { id: true }
      })
      : []

    const outletIds = outlets.map(outlet => outlet.id)

    // If alert has a related token, verify it's from teleshop manager's outlets
    if (alert.relatedEntity) {
      const token = await prisma.token.findUnique({
        where: { id: alert.relatedEntity },
        select: { outletId: true }
      })

      if (!token || !outletIds.includes(token.outletId)) {
        return res.status(403).json({ error: "Access denied to this alert" })
      }
    }

    const updatedAlert = await prisma.alert.update({
      where: { id: alertId },
      data: { isRead: true }
    })

    res.json(updatedAlert)
  } catch (error) {
    console.error("Mark alert as read error:", error)
    res.status(500).json({ error: "Failed to mark alert as read" })
  }
})

// ─────────────────────────────────────────────────────────
// Closure Notices – Teleshop Manager
// ─────────────────────────────────────────────────────────

// List closure notices for the TM's branch
router.get("/closure-notices", async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    if (!tm.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }
    const notices = await (prisma as any).closureNotice.findMany({
      where: { outletId: tm.branchId },
      orderBy: { startsAt: "asc" }
    })
    res.json({ success: true, notices })
  } catch (error) {
    console.error("Get closure notices error:", error)
    res.status(500).json({ error: "Failed to fetch closure notices" })
  }
})

// Create a closure notice for the TM's branch
router.post("/closure-notices", async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    if (!tm.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }
    const { title, message, startsAt, endsAt, noticeType, isRecurring, recurringType, recurringDays, recurringEndDate } = req.body
    if (!title || !message || !startsAt || !endsAt) {
      return res.status(400).json({ error: "title, message, startsAt, and endsAt are required" })
    }
    if (!isRecurring && new Date(startsAt) >= new Date(endsAt)) {
      return res.status(400).json({ error: "endsAt must be after startsAt" })
    }
    const type = noticeType === "standard" ? "standard" : "closure"
    const notice = await (prisma as any).closureNotice.create({
      data: {
        outletId: tm.branchId,
        title,
        message,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        createdBy: "teleshop_manager",
        createdById: tm.id,
        noticeType: type,
        isRecurring: Boolean(isRecurring),
        recurringType: isRecurring ? (recurringType || "weekly") : null,
        recurringDays: isRecurring && Array.isArray(recurringDays) ? recurringDays : [],
        recurringEndDate: recurringEndDate ? new Date(recurringEndDate) : null
      }
    })
    res.json({ success: true, notice })
  } catch (error) {
    console.error("Create closure notice error:", error)
    res.status(500).json({ error: "Failed to create closure notice" })
  }
})

// Update a closure notice (must belong to TM's branch)
router.put("/closure-notices/:noticeId", async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    const { noticeId } = req.params
    if (!tm.branchId) return res.status(400).json({ error: "You are not assigned to any outlet" })
    const existing = await (prisma as any).closureNotice.findFirst({ where: { id: noticeId, outletId: tm.branchId } })
    if (!existing) return res.status(404).json({ error: "Notice not found or not at your outlet" })
    const { title, message, startsAt, endsAt, noticeType, isRecurring, recurringType, recurringDays, recurringEndDate } = req.body
    const type = noticeType === "standard" ? "standard" : "closure"
    const updated = await (prisma as any).closureNotice.update({
      where: { id: noticeId },
      data: {
        title, message,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        noticeType: type,
        isRecurring: Boolean(isRecurring),
        recurringType: isRecurring ? (recurringType || "weekly") : null,
        recurringDays: isRecurring && Array.isArray(recurringDays) ? recurringDays : [],
        recurringEndDate: recurringEndDate ? new Date(recurringEndDate) : null,
      }
    })
    res.json({ success: true, notice: updated })
  } catch (error) {
    console.error("Update closure notice error:", error)
    res.status(500).json({ error: "Failed to update closure notice" })
  }
})

// Delete a closure notice (must belong to TM's branch)
router.delete("/closure-notices/:noticeId", async (req: any, res) => {
  try {
    const tm = req.teleshopManager
    const { noticeId } = req.params
    if (!tm.branchId) {
      return res.status(400).json({ error: "You are not assigned to any outlet" })
    }
    const existing = await (prisma as any).closureNotice.findFirst({
      where: { id: noticeId, outletId: tm.branchId }
    })
    if (!existing) {
      return res.status(404).json({ error: "Notice not found or not at your outlet" })
    }
    await (prisma as any).closureNotice.delete({ where: { id: noticeId } })
    res.json({ success: true, message: "Closure notice deleted" })
  } catch (error) {
    console.error("Delete closure notice error:", error)
    res.status(500).json({ error: "Failed to delete closure notice" })
  }
})

// ─── Audit Logs ───────────────────────────────────────────────────────────────
// GET /teleshop-manager/audit-logs
// Returns a combined timeline of CompletedServices, TransferLogs, BreakLogs and
// ServiceCases for the teleshop manager's assigned branch.  Supports period
// presets (today | week | month | year) or a custom startDate/endDate range,
// plus optional officerId and logType filters.
router.get("/audit-logs", async (req: any, res) => {
  try {
    const tm = req.teleshopManager

    if (!tm.branchId) {
      return res.json({
        logs: [],
        summary: { completedServices: 0, transfers: 0, breaks: 0, serviceCases: 0, total: 0 },
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false }
      })
    }

    const {
      period = "today",   // today | week | month | year | custom
      startDate,
      endDate,
      officerId,
      logType = "all",    // all | completed_services | transfers | breaks | service_cases
      page = "1",
      limit = "50",
      export: isExport = "false"
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const maxLimit = isExport === "true" ? 10000 : 200
    const limitNum = Math.min(maxLimit, Math.max(1, parseInt(limit as string)))

    // ── Date range calculation ──────────────────────────────────────────────
    const now = new Date()
    let rangeStart: Date
    let rangeEnd: Date = new Date(now.getTime() + 24 * 60 * 60 * 1000) // default: tomorrow (inclusive)

    if (period === "custom" && startDate && endDate) {
      rangeStart = new Date(startDate as string)
      rangeEnd = new Date(endDate as string)
      // Make endDate inclusive (end of that day)
      rangeEnd.setHours(23, 59, 59, 999)
    } else if (period === "week") {
      rangeStart = new Date(now)
      rangeStart.setDate(now.getDate() - 7)
      rangeStart.setHours(0, 0, 0, 0)
    } else if (period === "month") {
      rangeStart = new Date(now)
      rangeStart.setMonth(now.getMonth() - 1)
      rangeStart.setHours(0, 0, 0, 0)
    } else if (period === "year") {
      rangeStart = new Date(now)
      rangeStart.setFullYear(now.getFullYear() - 1)
      rangeStart.setHours(0, 0, 0, 0)
    } else {
      // today (default)
      rangeStart = new Date(now)
      rangeStart.setHours(0, 0, 0, 0)
    }

    // ── Fetch each log type in parallel ────────────────────────────────────
    // Build officer filter for branch
    const officerFilter: any = { outletId: tm.branchId }
    if (officerId) officerFilter.id = officerId

    const officersAtBranch = await prisma.officer.findMany({
      where: officerFilter,
      select: { id: true, name: true, counterNumber: true, mobileNumber: true }
    })
    const officerIds = officersAtBranch.map((o: any) => o.id)
    const officerMap: Record<string, any> = {}
    officersAtBranch.forEach((o: any) => { officerMap[o.id] = o })

    const dateRange = { gte: rangeStart, lte: rangeEnd }

    const [completedServices, transferLogs, breakLogs, serviceCases] = await Promise.all([
      // 1. Completed services
      (logType === "all" || logType === "completed_services")
        ? prisma.completedService.findMany({
          where: {
            outletId: tm.branchId,
            officerId: officerId ? (officerId as string) : { in: officerIds },
            completedAt: dateRange
          },
          include: {
            token: {
              select: {
                tokenNumber: true,
                billPaymentIntent: true,
                billPaymentMethod: true,
                billPaymentAmount: true,
                isPriority: true,
                isTransferred: true,
                accountRef: true,
                sltTelephoneNumber: true,
                preferredLanguages: true,
                createdAt: true,
                calledAt: true,
                startedAt: true,
                completedAt: true,
                customer: { select: { id: true, name: true, mobileNumber: true, nicNumber: true, email: true } },
                serviceCases: {
                  select: {
                    refNumber: true,
                    status: true,
                    createdAt: true,
                    completedAt: true,
                    lastUpdatedAt: true,
                    updates: { orderBy: { createdAt: "desc" }, take: 10 }
                  },
                  take: 1
                }
              }
            },
            service: { select: { id: true, code: true, title: true } },
            officer: { select: { id: true, name: true, counterNumber: true, mobileNumber: true } },
            outlet: { select: { id: true, name: true, location: true } }
          },
          orderBy: { completedAt: "desc" }
        })
        : Promise.resolve([]),

      // 2. Transfer logs
      (logType === "all" || logType === "transfers")
        ? (prisma as any).transferLog.findMany({
          where: {
            fromOfficerId: { in: officerIds },
            createdAt: dateRange
          },
          include: {
            token: {
              select: {
                tokenNumber: true,
                outletId: true,
                customer: { select: { id: true, name: true, mobileNumber: true } }
              }
            },
            fromOfficer: { select: { id: true, name: true, counterNumber: true } }
          },
          orderBy: { createdAt: "desc" }
        })
        : Promise.resolve([]),

      // 3. Break logs
      (logType === "all" || logType === "breaks")
        ? (prisma as any).breakLog.findMany({
          where: {
            officerId: { in: officerIds },
            startedAt: dateRange
          },
          include: {
            Officer: { select: { id: true, name: true, counterNumber: true } }
          },
          orderBy: { startedAt: "desc" }
        })
        : Promise.resolve([]),

      // 4. Service cases
      (logType === "all" || logType === "service_cases")
        ? (prisma as any).serviceCase.findMany({
          where: {
            outletId: tm.branchId,
            officerId: officerId ? (officerId as string) : { in: officerIds },
            createdAt: dateRange
          },
          include: {
            officer: { select: { id: true, name: true, counterNumber: true, mobileNumber: true } },
            customer: { select: { id: true, name: true, mobileNumber: true, nicNumber: true, email: true } },
            outlet: { select: { id: true, name: true, location: true } },
            token: {
              select: {
                tokenNumber: true,
                isPriority: true,
                isTransferred: true,
                accountRef: true,
                sltTelephoneNumber: true,
                billPaymentIntent: true,
                billPaymentMethod: true,
                billPaymentAmount: true,
                preferredLanguages: true,
                createdAt: true,
                calledAt: true,
                startedAt: true,
                completedAt: true
              }
            },
            updates: {
              orderBy: { createdAt: "desc" },
              take: 20
            }
          },
          orderBy: { createdAt: "desc" }
        })
        : Promise.resolve([])
    ])

    // ── Normalise into a unified event timeline ────────────────────────────
    type AuditEntry = {
      id: string
      type: "completed_service" | "transfer" | "break" | "service_case"
      timestamp: string
      officer: { id: string; name: string; counterNumber?: number | null } | null
      description: string
      meta: Record<string, any>
    }

    const entries: AuditEntry[] = []

    // Completed services
    for (const cs of completedServices as any[]) {
      const tok = cs.token ?? null
      const sc = tok?.serviceCases?.[0] ?? null

      // Compute time spans in ms
      const tokenIssuedAt = tok?.createdAt ?? null
      const calledAt = tok?.calledAt ?? null
      const startedAt = tok?.startedAt ?? null
      const completedAt = tok?.completedAt ?? cs.completedAt ?? null
      const waitDurationMs =
        calledAt && tokenIssuedAt
          ? new Date(calledAt).getTime() - new Date(tokenIssuedAt).getTime()
          : null
      const serviceDurationMs =
        completedAt && startedAt
          ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
          : null
      const totalDurationMs =
        completedAt && tokenIssuedAt
          ? new Date(completedAt).getTime() - new Date(tokenIssuedAt).getTime()
          : null

      entries.push({
        id: cs.id,
        type: "completed_service",
        timestamp: cs.completedAt,
        officer: cs.officer ?? null,
        description: `Token #${tok?.tokenNumber} — ${cs.service?.title || cs.service?.code} completed`,
        meta: {
          // Basic
          tokenNumber: tok?.tokenNumber,
          service: cs.service,
          durationSeconds: cs.duration ?? null,
          notes: cs.notes ?? null,
          // Customer
          customer: tok?.customer
            ? { ...tok.customer, preferredLanguages: tok.preferredLanguages ?? [] }
            : null,
          // Officer enriched
          officerMobile: cs.officer?.mobileNumber ?? null,
          // Token details
          isPriority: tok?.isPriority ?? false,
          isTransferred: tok?.isTransferred ?? false,
          accountRef: tok?.accountRef ?? null,
          sltTelephoneNumber: tok?.sltTelephoneNumber ?? null,
          // Timeline
          tokenIssuedAt,
          calledAt,
          startedAt,
          completedAt,
          // Durations
          waitDurationMs,
          serviceDurationMs,
          totalDurationMs,
          // Bill payment
          billPaymentIntent: tok?.billPaymentIntent ?? null,
          billPaymentMethod: tok?.billPaymentMethod ?? null,
          billPaymentAmount: tok?.billPaymentAmount ?? null,
          // Outlet
          outlet: cs.outlet ?? null,
          // Service case
          serviceCase: sc
            ? {
              refNumber: sc.refNumber,
              status: sc.status,
              createdAt: sc.createdAt,
              completedAt: sc.completedAt,
              lastUpdatedAt: sc.lastUpdatedAt,
              updates: sc.updates ?? []
            }
            : null
        }
      })
    }

    // Transfer logs
    for (const tl of transferLogs as any[]) {
      // Only include if token belongs to this outlet
      if (tl.token?.outletId && tl.token.outletId !== tm.branchId) continue
      entries.push({
        id: tl.id,
        type: "transfer",
        timestamp: tl.createdAt,
        officer: tl.fromOfficer ?? null,
        description: `Token #${tl.token?.tokenNumber} transferred (Counter ${tl.fromCounterNumber ?? "?"} → ${tl.toCounterNumber ?? "?"})`,
        meta: {
          tokenNumber: tl.token?.tokenNumber,
          customer: tl.token?.customer,
          fromCounterNumber: tl.fromCounterNumber,
          toCounterNumber: tl.toCounterNumber,
          previousServiceTypes: tl.previousServiceTypes,
          newServiceTypes: tl.newServiceTypes,
          notes: tl.notes ?? null
        }
      })
    }

    // Break logs
    for (const bl of breakLogs as any[]) {
      const officer = bl.Officer ?? null
      const durationMins = bl.endedAt
        ? Math.round((new Date(bl.endedAt).getTime() - new Date(bl.startedAt).getTime()) / 60000)
        : null
      entries.push({
        id: bl.id,
        type: "break",
        timestamp: bl.startedAt,
        officer: officer ? { id: officer.id, name: officer.name, counterNumber: officer.counterNumber } : null,
        description: bl.endedAt
          ? `Break ended (${durationMins} min)`
          : `Break started`,
        meta: {
          startedAt: bl.startedAt,
          endedAt: bl.endedAt ?? null,
          durationMinutes: durationMins
        }
      })
    }

    // Service cases
    for (const sc of serviceCases as any[]) {
      const tok = sc.token ?? null
      const tokenIssuedAt = tok?.createdAt ?? null
      const calledAt = tok?.calledAt ?? null
      const startedAt = tok?.startedAt ?? null
      const completedAt = tok?.completedAt ?? sc.completedAt ?? null
      const waitDurationMs =
        calledAt && tokenIssuedAt
          ? new Date(calledAt).getTime() - new Date(tokenIssuedAt).getTime()
          : null
      const serviceDurationMs =
        completedAt && startedAt
          ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
          : null
      const totalDurationMs =
        completedAt && tokenIssuedAt
          ? new Date(completedAt).getTime() - new Date(tokenIssuedAt).getTime()
          : null

      entries.push({
        id: sc.id,
        type: "service_case",
        timestamp: sc.createdAt,
        officer: sc.officer ?? null,
        description: `Service case ${sc.refNumber} — ${sc.status}`,
        meta: {
          refNumber: sc.refNumber,
          serviceTypes: sc.serviceTypes,
          status: sc.status,
          customer: sc.customer ?? null,
          outlet: sc.outlet ?? null,
          createdAt: sc.createdAt,
          completedAt: sc.completedAt ?? null,
          lastUpdatedAt: sc.lastUpdatedAt ?? null,
          updates: sc.updates ?? [],
          latestUpdate: sc.updates?.[0] ?? null,
          // Token details
          tokenNumber: tok?.tokenNumber ?? null,
          isPriority: tok?.isPriority ?? false,
          isTransferred: tok?.isTransferred ?? false,
          accountRef: tok?.accountRef ?? null,
          sltTelephoneNumber: tok?.sltTelephoneNumber ?? null,
          preferredLanguages: tok?.preferredLanguages ?? [],
          // Bill payment
          billPaymentIntent: tok?.billPaymentIntent ?? null,
          billPaymentMethod: tok?.billPaymentMethod ?? null,
          billPaymentAmount: tok?.billPaymentAmount ?? null,
          // Service timeline
          tokenIssuedAt,
          calledAt,
          startedAt,
          tokenCompletedAt: completedAt,
          waitDurationMs,
          serviceDurationMs,
          totalDurationMs
        }
      })
    }

    // ── Sort all entries newest-first ──────────────────────────────────────
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // ── Paginate ───────────────────────────────────────────────────────────
    const total = entries.length
    const paged = entries.slice((pageNum - 1) * limitNum, pageNum * limitNum)

    res.json({
      logs: paged,
      summary: {
        completedServices: (completedServices as any[]).length,
        transfers: (transferLogs as any[]).filter((tl: any) => !tl.token?.outletId || tl.token.outletId === tm.branchId).length,
        breaks: (breakLogs as any[]).length,
        serviceCases: (serviceCases as any[]).length,
        total
      },
      officers: officersAtBranch,
      period: { preset: period, start: rangeStart, end: rangeEnd },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasNext: pageNum * limitNum < total,
        hasPrev: pageNum > 1
      }
    })
  } catch (error) {
    console.error("Audit logs error:", error)
    res.status(500).json({ error: "Failed to fetch audit logs" })
  }
})

// QR Code Setup for Android TV Outlet Displays - NEW PROFESSIONAL FEATURES

// Setup Android TV device via QR code
router.post("/outlet-setup-qr", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { deviceId, deviceName, macAddress, setupCode, timestamp } = req.body

    // Validate required fields
    if (!deviceId || !deviceName || !setupCode) {
      return res.status(400).json({ 
        error: "Missing required fields: deviceId, deviceName, and setupCode are required" 
      })
    }

    // Verify teleshop manager has a branch assigned
    if (!teleshopManager.branchId) {
      return res.status(403).json({ 
        error: "You must be assigned to a branch to configure outlet displays" 
      })
    }

     // Validate setup code format (allow alphanumeric with optional hyphens for APK compatibility)
    if (!/^[a-zA-Z0-9-]{4,30}$/.test(setupCode)) {
      return res.status(400).json({ 
        error: "Invalid setup code format. Please scan a valid QR code from the outlet display." 
      })
    }

    // Get global QR tokens cache
    const managerQRTokens = (global as any).globalManagerQRTokens

    // Optimize: Get outlet information and validate setup code in parallel
    const [outlet, dbToken] = await Promise.all([
      prisma.outlet.findUnique({
        where: { id: teleshopManager.branchId },
        select: { id: true, name: true, location: true, displaySettings: true }
      }),
      // Only check database if not in memory cache
      managerQRTokens && managerQRTokens.has(setupCode) 
        ? null 
        : prisma.managerQRToken.findUnique({ where: { token: setupCode } })
    ])

    if (!outlet) {
      return res.status(404).json({ error: "Assigned outlet not found" })
    }

    // Validate setup code exists in QR tokens (check memory first, then database)
    let tokenData = null
    
    if (managerQRTokens && managerQRTokens.has(setupCode)) {
      tokenData = managerQRTokens.get(setupCode)
    } else if (dbToken) {
      tokenData = {
        outletId: dbToken.outletId,
        generatedAt: dbToken.generatedAt.toISOString()
      }
      // Cache in memory for future requests
      if (managerQRTokens) {
        managerQRTokens.set(setupCode, tokenData)
      }
    } else {
      // Fast auto-register APK-generated tokens for the manager's outlet
      console.log(`🔄 Auto-registering APK token: ${setupCode}`)
      
      try {
        // Use upsert for better performance and race condition handling
        await prisma.managerQRToken.upsert({
          where: { token: setupCode },
          update: { outletId: teleshopManager.branchId }, // Update if exists
          create: {
            token: setupCode,
            outletId: teleshopManager.branchId,
            generatedAt: new Date()
          }
        })
        
        tokenData = {
          outletId: teleshopManager.branchId,
          generatedAt: new Date().toISOString()
        }
        
        // Cache in memory
        if (managerQRTokens) {
          managerQRTokens.set(setupCode, tokenData)
        }
        
        console.log(`✅ Auto-registered APK token: ${setupCode}`)
      } catch (error: any) {
        console.error(`❌ Auto-registration failed: ${setupCode}`, error.message)
        // Continue anyway for manager's own outlet
        tokenData = {
          outletId: teleshopManager.branchId,
          generatedAt: new Date().toISOString()
        }
      }
    }
    
    if (!tokenData) {
      return res.status(400).json({ 
        error: "Invalid setup code. Please scan a valid QR code from the outlet display." 
      })
    }
    
    // Verify the token is for the correct outlet
    if (tokenData.outletId !== teleshopManager.branchId) {
      return res.status(400).json({ 
        error: "This setup code is for a different outlet. Please scan the correct QR code." 
      })
    }

    // Check if setup code has expired (24 hours from generation)
    const currentTime = Date.now()
    const timeDiff = currentTime - timestamp
    const hourInMs = 24 * 3600000 // 24 hours - consistent with QR generation
    
    console.log("QR Setup validation:", {
      setupCode: setupCode,
      tokenOutletId: tokenData.outletId,
      managerOutletId: teleshopManager.branchId,
      timestamp: timestamp,
      currentTime: currentTime,
      timeDiff: timeDiff,
      timeDiffHours: Math.round(timeDiff / 3600000),
      isExpired: timeDiff > hourInMs
    })
    
    if (timestamp && timeDiff > hourInMs) {
      return res.status(400).json({ 
        error: "Setup code has expired. Please generate a new QR code on the Android TV device." 
      })
    }

    // Save device configuration to outlet displaySettings
    const currentDisplaySettings = outlet.displaySettings as any || {}
    const existingDevices = currentDisplaySettings.linkedDevices || []
    
    // Check for existing device with same deviceId and warn user
    const existingDevice = existingDevices.find((device: any) => device.deviceId === deviceId)
    if (existingDevice) {
      console.log(`Device ${deviceId} already exists, replacing configuration`)
    }
    
     // Optimize: Prepare device record with current timestamp (reuse)
    const now = new Date()
    const deviceRecord = {
      id: randomUUID(), // Use proper UUID instead of timestamp
      deviceId: deviceId,
      deviceName: deviceName,
      macAddress: macAddress || 'Unknown',
      setupCode: setupCode,
      configuredAt: now.toISOString(),
      configuredBy: teleshopManager.id,
      isActive: true,
      lastSeen: now.toISOString()
    }

    // Remove any existing device with same deviceId and prepare new settings
    const filteredDevices = existingDevices.filter((device: any) => device.deviceId !== deviceId)
    const updatedDisplaySettings = {
      ...currentDisplaySettings,
      linkedDevices: [...filteredDevices, deviceRecord]
    }

    // Update outlet and send notifications in parallel for faster response
    const [updateResult] = await Promise.all([
      prisma.outlet.update({
        where: { id: teleshopManager.branchId },
        data: { displaySettings: updatedDisplaySettings }
      }),
      // Fire audit log async (don't wait)
      auditLog(
        teleshopManager.id, 
        "OUTLET_DEVICE_CONFIGURED", 
        "outlet", 
        outlet.id, 
        {
          deviceId: deviceId,
          deviceName: deviceName,
          setupCode: setupCode,
          outletName: outlet.name,
          method: 'QR_CODE'
        }
      )
    ])

    console.log(`✅ Device configured successfully:`, {
      deviceId: deviceId,
      deviceName: deviceName,
      outletId: outlet.id,
      outletName: outlet.name,
      configuredAt: deviceRecord.configuredAt
    })

    // Send instant WebSocket notification to device (if connected)
    const isDeviceConnected = wsManager.isDeviceConnected(deviceId)
    console.log(`📡 WebSocket device connected: ${isDeviceConnected}`)
    
    if (isDeviceConnected) {
      wsManager.sendToDevice(deviceId, {
        type: "SETUP_COMPLETE",
        data: {
          success: true,
          device: deviceRecord,
          outlet: {
            id: outlet.id,
            name: outlet.name,
            location: outlet.location
          },
          configuredBy: teleshopManager.name,
          configuredAt: deviceRecord.configuredAt
        }
      })
      console.log(`📡 Instant notification sent to device: ${deviceId}`)
    } else {
      console.log(`⚠️ Device ${deviceId} not connected via WebSocket - APK should poll /setup-status`)
    }

    // ALWAYS broadcast SETUP_COMPLETE to ALL clients (this ensures APK gets it even if not registered by deviceId)
    console.log(`📢 Broadcasting SETUP_COMPLETE to all WebSocket clients...`)
    wsManager.broadcast({
      type: "SETUP_COMPLETE",
      data: {
        success: true,
        deviceId: deviceId,
        deviceName: deviceName,
        device: deviceRecord,
        outlet: {
          id: outlet.id,
          name: outlet.name,
          location: outlet.location
        },
        configuredBy: teleshopManager.name,
        configuredAt: deviceRecord.configuredAt
      }
    })

    // Send broadcast notification (async, don't block response)
    setImmediate(() => {
      broadcast({
        type: "DEVICE_CONFIGURED",
        data: {
          deviceId: deviceId,
          deviceName: deviceName,
          outletId: outlet.id,
          configuredBy: teleshopManager.id,
          configuredAt: deviceRecord.configuredAt
        }
      })
    })

    console.log(`✅ QR setup complete - response sent to dashboard`)

    // Send response immediately
    res.json({
      success: true,
      message: `Android TV "${deviceName}" has been successfully configured for ${outlet.name}`,
      device: deviceRecord,
      outlet: {
        id: outlet.id,
        name: outlet.name,
        location: outlet.location
      }
    })

  } catch (error: any) {
    console.error("QR setup error:", error)
    res.status(500).json({ 
      error: "Failed to configure Android TV device", 
      details: error.message 
    })
  }
})

// Check if device is configured (APK polling endpoint) - NO AUTH REQUIRED
// This is called by APK to check if QR was scanned
router.get("/check-device-config/:deviceId", async (req: any, res) => {
  try {
    const { deviceId } = req.params
    
    console.log(`📱 APK checking configuration for device: ${deviceId}`)

    // Find device in any outlet's displaySettings
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        location: true,
        displaySettings: true
      }
    })

    for (const outlet of outlets) {
      const settings = outlet.displaySettings as any
      const linkedDevices = settings?.linkedDevices || []
      const device = linkedDevices.find((d: any) => d.deviceId === deviceId && d.isActive)
      
      if (device) {
        console.log(`✅ Device ${deviceId} is configured for outlet: ${outlet.name}`)
        return res.json({
          isConfigured: true,
          outletId: outlet.id,
          outletName: outlet.name,
          baseUrl: process.env.BASE_URL || "https://sltsecmanage.slt.lk:7443/",
          device: device
        })
      }
    }

    // Not configured
    res.json({
      isConfigured: false,
      outletId: null,
      baseUrl: null
    })

  } catch (error: any) {
    console.error("Check device config error:", error)
    res.status(500).json({ 
      isConfigured: false,
      error: "Failed to check device configuration"
    })
  }
})

// Get linked outlet devices
router.get("/outlet-devices", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    if (!teleshopManager.branchId) {
      return res.json({ devices: [] })
    }

    // Get outlet with linked devices
    const outlet = await prisma.outlet.findUnique({
      where: { id: teleshopManager.branchId },
      select: { displaySettings: true }
    })

    const displaySettings = outlet?.displaySettings as any || {}
    const linkedDevices = displaySettings.linkedDevices || []

    res.json({ devices: linkedDevices })

  } catch (error: any) {
    console.error("Get outlet devices error:", error)
    res.status(500).json({ error: "Failed to get outlet devices" })
  }
})

// Remove/deactivate outlet device
router.delete("/outlet-devices/:deviceId", async (req: any, res) => {
  try {
    console.log("🗑️  Device removal request received:", {
      deviceIdParam: req.params.deviceId,
      managerId: req.teleshopManager?.id,
      managerName: req.teleshopManager?.name,
      branchId: req.teleshopManager?.branchId,
      timestamp: new Date().toISOString()
    })

    const teleshopManager = req.teleshopManager
    const { deviceId: deviceIdParam } = req.params

    if (!teleshopManager) {
      console.log("❌ No teleshop manager in request")
      return res.status(401).json({ error: "Authentication required" })
    }

    if (!teleshopManager.branchId) {
      console.log("❌ Manager not assigned to branch:", teleshopManager.id)
      return res.status(403).json({ error: "You must be assigned to a branch" })
    }

    console.log("✅ Authentication passed, proceeding with removal...")

    // Remove from displaySettings
    const outlet = await prisma.outlet.findUnique({
      where: { id: teleshopManager.branchId },
      select: { id: true, name: true, displaySettings: true }
    })

    if (!outlet) {
      console.log("❌ Outlet not found:", teleshopManager.branchId)
      return res.status(404).json({ error: "Outlet not found" })
    }

    console.log("✅ Outlet found:", outlet.name)

    const displaySettings = outlet.displaySettings as any || {}
    const linkedDevices = displaySettings.linkedDevices || []
    
    console.log("📱 Current devices:", linkedDevices.length)
    console.log("🔍 Looking for device with ID:", deviceIdParam)
    
    // Find the device being removed - check both internal ID and deviceId
    const deviceToRemove = linkedDevices.find((device: any) => 
      device.id === deviceIdParam || device.deviceId === deviceIdParam
    )
    
    if (!deviceToRemove) {
      console.log("❌ Device not found in outlet:", deviceIdParam)
      console.log("Available devices:", linkedDevices.map((d: any) => ({ 
        name: d.deviceName, 
        internalId: d.id, 
        deviceId: d.deviceId 
      })))
      return res.status(404).json({ error: "Device not found" })
    }
    
    console.log("✅ Device found for removal:", {
      name: deviceToRemove.deviceName,
      internalId: deviceToRemove.id,
      deviceId: deviceToRemove.deviceId
    })
    
    // Filter by both internal ID and deviceId to ensure removal
    const updatedDevices = linkedDevices.filter((device: any) => 
      device.id !== deviceIdParam && device.deviceId !== deviceIdParam
    )

    console.log("🔄 Updating database and sending immediate notifications...")
    
    // Update database first
    await prisma.outlet.update({
      where: { id: teleshopManager.branchId },
      data: { 
        displaySettings: {
          ...displaySettings,
          linkedDevices: updatedDevices
        }
      }
    })

    console.log("✅ Database updated successfully")

    // Send URGENT priority broadcasts (multiple delivery for reliability)
    const removalBroadcast = {
      type: "DEVICE_REMOVED",
      data: {
        deviceId: deviceToRemove.deviceId,
        deviceName: deviceToRemove.deviceName,
        outletId: teleshopManager.branchId,
        outletName: outlet.name,
        removedBy: teleshopManager.id,
        removedAt: new Date().toISOString(),
        resetToQR: true,
        action: "RECONFIGURE_REQUIRED",
        urgent: true
      }
    }
    
    // Use priority broadcast for critical device removal (sends multiple times)
    priorityBroadcast(removalBroadcast)
    priorityBroadcast({
      type: "APK_DEVICE_RESET", 
      deviceId: deviceToRemove.deviceId,
      message: "Device removed - return to QR setup",
      timestamp: new Date().toISOString(),
      urgent: true
    })
    priorityBroadcast({
      type: "APK_FORCE_RESET",
      deviceId: deviceToRemove.deviceId, 
      action: "IMMEDIATE_QR_RESET"
    })

    console.log("✅ IMMEDIATE broadcasts sent for device:", deviceToRemove.deviceId)

    // Fire audit log asynchronously (don't block response)
    setImmediate(() => {
      auditLog(
        teleshopManager.id, 
        "OUTLET_DEVICE_REMOVED", 
        "outlet", 
        teleshopManager.branchId, 
        { 
          deviceIdParam: deviceIdParam,
          actualDeviceId: deviceToRemove.deviceId,
          deviceName: deviceToRemove.deviceName,
          outletName: outlet.name
        }
      )
    })
    
    // Send response immediately (don't wait for audit log)
    res.json({ 
      success: true, 
      message: "Device removed successfully",
      removedDevice: {
        internalId: deviceToRemove.id,
        deviceId: deviceToRemove.deviceId,
        deviceName: deviceToRemove.deviceName
      },
      broadcastsSent: 3 // Indicates multiple notifications sent
    })

    console.log("✅ Device removal completed successfully - APK should reset immediately")

  } catch (error: any) {
    console.error("❌ Remove outlet device error:", error)
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      deviceIdParam: req.params.deviceId,
      managerId: req.teleshopManager?.id
    })
    res.status(500).json({ 
      error: "Failed to remove device", 
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

// =============================================================================
// WHATSAPP WEB-STYLE QR CODE AUTHENTICATION - NEW IMPLEMENTATION
// =============================================================================

import { qrSessionService } from "../services/qrSessionService"
import { deviceLinkService } from "../services/deviceLinkService"
import { wsManager, QR_SESSION_ROOM, OUTLET_DEVICES_ROOM } from "../services/wsManager"

/**
 * POST /api/teleshop-manager/scan-outlet-qr
 * Manager scans QR code from outlet TV display
 * First step of WhatsApp Web-style linking
 */
router.post("/scan-outlet-qr", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { qrData } = req.body

    // Validate manager has branch assigned
    if (!teleshopManager.branchId) {
      return res.status(403).json({
        error: "You must be assigned to a branch to link outlet displays"
      })
    }

    // Parse QR data: format is "sessionId:qrToken"
    if (!qrData || typeof qrData !== 'string') {
      return res.status(400).json({
        error: "Invalid QR code data"
      })
    }

    const parts = qrData.split(':')
    if (parts.length !== 2) {
      return res.status(400).json({
        error: "Invalid QR code format"
      })
    }

    const [sessionId, qrToken] = parts

    // Validate QR token
    const session = await qrSessionService.validateQRToken(qrToken)

    if (!session) {
      return res.status(400).json({
        error: "Invalid or expired QR code. Please generate a new one on the TV display."
      })
    }

    // Verify the session matches
    if (session.sessionId !== sessionId) {
      return res.status(400).json({
        error: "QR code mismatch. Please try again."
      })
    }

    // Verify outlet matches manager's branch
    if (session.outletId !== teleshopManager.branchId) {
      return res.status(403).json({
        error: "This QR code is for a different outlet. Please scan the correct code."
      })
    }

    // Update session status to 'scanned'
    await qrSessionService.updateSessionStatus({
      sessionId: sessionId,
      status: 'scanned',
      scannedByManagerId: teleshopManager.id
    })

    // Notify the TV display that QR was scanned
    wsManager.sendToSession(sessionId, {
      type: "QR_SCANNED",
      data: {
        scannedBy: teleshopManager.name,
        scannedAt: new Date().toISOString()
      }
    })

    console.log(`📱 QR code scanned:`, {
      sessionId,
      managerId: teleshopManager.id,
      managerName: teleshopManager.name,
      outletId: session.outletId
    })

    // Return device info for manager to review before approving
    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        outlet: session.outlet
      },
      message: "QR code scanned successfully. Please review and approve the device."
    })

  } catch (error: any) {
    console.error("❌ Scan QR code error:", error)
    res.status(500).json({
      error: "Failed to scan QR code",
      details: error.message
    })
  }
})

/**
 * POST /api/teleshop-manager/approve-link
 * Manager approves device link after scanning QR
 * Second step of WhatsApp Web-style linking
 */
router.post("/approve-link", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { sessionId } = req.body

    if (!sessionId) {
      return res.status(400).json({
        error: "Missing sessionId"
      })
    }

    // Get session
    const session = await qrSessionService.getSession(sessionId)

    if (!session) {
      return res.status(404).json({
        error: "Session not found"
      })
    }

    // Verify session was scanned by this manager
    if (session.scannedByManagerId !== teleshopManager.id) {
      return res.status(403).json({
        error: "You did not scan this QR code"
      })
    }

    // Verify outlet matches manager's branch
    if (session.outletId !== teleshopManager.branchId) {
      return res.status(403).json({
        error: "Outlet mismatch"
      })
    }

    // Create or update device link
    const deviceLink = await deviceLinkService.createLink({
      deviceId: session.deviceId!,
      deviceName: session.deviceName!,
      outletId: session.outletId,
      managerId: teleshopManager.id,
      configData: {
        linkedVia: 'qr_session',
        sessionId: sessionId
      }
    })

    // Update session status to 'linked'
    await qrSessionService.updateSessionStatus({
      sessionId: sessionId,
      status: 'linked',
      linkedManagerId: teleshopManager.id,
      linkedDeviceId: session.deviceId!
    })

    // Notify the TV display that link is established
    const linkData = {
      deviceId: deviceLink.deviceId,
      deviceName: deviceLink.deviceName,
      outletId: deviceLink.outletId,
      outlet: deviceLink.outlet,
      linkedAt: deviceLink.linkedAt,
      managerId: teleshopManager.id,
      managerName: teleshopManager.name
    }

    wsManager.sendToSession(sessionId, {
      type: "LINK_ESTABLISHED",
      data: linkData
    })

    // Also broadcast to outlet devices room
    wsManager.broadcastToRoom(OUTLET_DEVICES_ROOM(session.outletId), {
      type: "DEVICE_LINKED",
      data: linkData
    })

    // Audit log
    auditLog(
      teleshopManager.id,
      "DEVICE_LINKED_VIA_QR",
      "device",
      deviceLink.deviceId,
      {
        deviceName: deviceLink.deviceName,
        sessionId: sessionId,
        method: 'whatsapp_web_style'
      }
    )

    console.log(`✅ Device link approved:`, {
      sessionId,
      deviceId: deviceLink.deviceId,
      deviceName: deviceLink.deviceName,
      managerId: teleshopManager.id
    })

    res.json({
      success: true,
      message: "Device linked successfully",
      device: linkData
    })

  } catch (error: any) {
    console.error("❌ Approve link error:", error)
    res.status(500).json({
      error: "Failed to approve device link",
      details: error.message
    })
  }
})

/**
 * POST /api/teleshop-manager/reject-link
 * Manager rejects device link after scanning QR
 * Alternative to approve - tells TV to regenerate QR
 */
router.post("/reject-link", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { sessionId, reason } = req.body

    if (!sessionId) {
      return res.status(400).json({
        error: "Missing sessionId"
      })
    }

    // Get session
    const session = await qrSessionService.getSession(sessionId)

    if (!session) {
      return res.status(404).json({
        error: "Session not found"
      })
    }

    // Update session status to 'rejected'
    await qrSessionService.updateSessionStatus({
      sessionId: sessionId,
      status: 'rejected',
      unlinkedReason: reason || 'manager_rejected'
    })

    // Notify the TV display
    wsManager.sendToSession(sessionId, {
      type: "LINK_REJECTED",
      data: {
        rejectedBy: teleshopManager.name,
        rejectedAt: new Date().toISOString(),
        reason: reason || 'Manager rejected the link'
      }
    })

    console.log(`❌ Device link rejected:`, {
      sessionId,
      deviceId: session.deviceId,
      managerId: teleshopManager.id,
      reason
    })

    res.json({
      success: true,
      message: "Device link rejected"
    })

  } catch (error: any) {
    console.error("❌ Reject link error:", error)
    res.status(500).json({
      error: "Failed to reject device link",
      details: error.message
    })
  }
})

/**
 * DELETE /api/teleshop-manager/unlink-device-instant/:deviceId
 * Manager-initiated instant device unlink (WhatsApp Web logout style)
 */
router.delete("/unlink-device-instant/:deviceId", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager
    const { deviceId } = req.params

    if (!deviceId) {
      return res.status(400).json({
        error: "Missing deviceId"
      })
    }

    // Get device link
    const deviceLink = await deviceLinkService.getLink(deviceId)

    if (!deviceLink) {
      return res.status(404).json({
        error: "Device not found"
      })
    }

    // Verify manager has permission (same outlet)
    if (deviceLink.outletId !== teleshopManager.branchId) {
      return res.status(403).json({
        error: "You don't have permission to unlink this device"
      })
    }

    // Unlink the device
    const success = await deviceLinkService.unlinkDevice(deviceId, 'manager_logout')

    if (!success) {
      return res.status(500).json({
        error: "Failed to unlink device"
      })
    }

    // Broadcast instant unlink to the TV display
    wsManager.sendToDevice(deviceId, {
      type: "DEVICE_UNLINKED",
      data: {
        unlinkedBy: 'manager',
        managerName: teleshopManager.name,
        unlinkedAt: new Date().toISOString(),
        action: 'return_to_qr_screen'
      }
    })

    // Also broadcast to outlet devices room
    wsManager.broadcastToRoom(OUTLET_DEVICES_ROOM(deviceLink.outletId), {
      type: "DEVICE_UNLINKED",
      data: {
        deviceId: deviceId,
        deviceName: deviceLink.deviceName,
        outletId: deviceLink.outletId,
        unlinkedBy: 'manager'
      }
    })

    // Audit log
    auditLog(
      teleshopManager.id,
      "DEVICE_UNLINKED_INSTANT",
      "device",
      deviceId,
      {
        deviceName: deviceLink.deviceName,
        method: 'whatsapp_web_style'
      }
    )

    console.log(`📱 Device unlinked instantly:`, {
      deviceId,
      deviceName: deviceLink.deviceName,
      managerId: teleshopManager.id,
      managerName: teleshopManager.name
    })

    res.json({
      success: true,
      message: "Device unlinked successfully"
    })

  } catch (error: any) {
    console.error("❌ Instant unlink device error:", error)
    res.status(500).json({
      error: "Failed to unlink device",
      details: error.message
    })
  }
})

/**
 * GET /api/teleshop-manager/linked-devices
 * Get all devices linked to manager's outlet
 */
router.get("/linked-devices", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    if (!teleshopManager.branchId) {
      return res.json({
        devices: []
      })
    }

    // Get all active devices for the outlet
    const devices = await deviceLinkService.getOutletDevices(teleshopManager.branchId, true)

    // Enhance with WebSocket connection status
    const devicesWithStatus = devices.map(device => ({
      ...device,
      websocketConnected: wsManager.isDeviceConnected(device.deviceId)
    }))

    res.json({
      devices: devicesWithStatus,
      total: devicesWithStatus.length
    })

  } catch (error: any) {
    console.error("❌ Get linked devices error:", error)
    res.status(500).json({
      error: "Failed to get linked devices",
      details: error.message
    })
  }
})

/**
 * GET /api/teleshop-manager/qr-code
 * Get existing customer registration QR code for teleshop manager's outlet
 */
router.get("/qr-code", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    if (!teleshopManager.branchId) {
      return res.status(400).json({
        error: "No branch assigned. Please contact your RTOM to assign you to a branch."
      })
    }

    // Get the latest QR token for the outlet
    const qrToken = await prisma.managerQRToken.findFirst({
      where: { outletId: teleshopManager.branchId },
      orderBy: { createdAt: 'desc' }
    })

    if (!qrToken) {
      return res.json({
        qrCode: null,
        message: "No QR code found. Generate a new one to allow customer registration."
      })
    }

    res.json({
      qrCode: {
        outletId: qrToken.outletId,
        token: qrToken.token,
        generatedAt: qrToken.generatedAt.toISOString()
      }
    })

  } catch (error: any) {
    console.error("❌ Get QR code error:", error)
    res.status(500).json({
      error: "Failed to get QR code",
      details: error.message
    })
  }
})

/**
 * POST /api/teleshop-manager/generate-qr
 * Generate new customer registration QR code for teleshop manager's outlet
 */
router.post("/generate-qr", async (req: any, res) => {
  try {
    const teleshopManager = req.teleshopManager

    if (!teleshopManager.branchId) {
      return res.status(400).json({
        error: "No branch assigned. Please contact your RTOM to assign you to a branch."
      })
    }

    // Generate random token for QR code
    const generateRandomToken = (): string => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let result = ''
      for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return result
    }

    const token = generateRandomToken()
    const generatedAt = new Date()

    // Delete any existing QR token for this outlet, then create new one
    await prisma.managerQRToken.deleteMany({
      where: { outletId: teleshopManager.branchId }
    })

    await prisma.managerQRToken.create({
      data: {
        token,
        outletId: teleshopManager.branchId,
        generatedAt,
        createdAt: generatedAt
      }
    })

    const qrCode = {
      outletId: teleshopManager.branchId,
      token,
      generatedAt: generatedAt.toISOString()
    }

    console.log(`Generated QR code for teleshop manager ${teleshopManager.name} at outlet ${teleshopManager.branchId}`)

    // Audit log
    auditLog(
      teleshopManager.id,
      "QR_CODE_GENERATED",
      "qr_token",
      token,
      {
        outletId: teleshopManager.branchId,
        generatedAt: generatedAt.toISOString()
      }
    )

    res.json({
      success: true,
      qrCode,
      message: "QR code generated successfully. Customers can now scan this code to register for the queue."
    })

  } catch (error: any) {
    console.error("❌ Generate QR code error:", error)
    res.status(500).json({
      error: "Failed to generate QR code",
      details: error.message
    })
  }
})



export default router