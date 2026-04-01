/**
 * Outlet Display APK Routes
 * Handles QR session generation and device linking for outlet TV displays
 */

import express, { Request, Response } from "express"
import { PrismaClient } from "@prisma/client"
import { qrSessionService } from "../services/qrSessionService"
import { deviceLinkService } from "../services/deviceLinkService"
import { wsManager, QR_SESSION_ROOM } from "../services/wsManager"

const router = express.Router()
const prisma = new PrismaClient()

/**
 * POST /api/outlet/generate-qr-session
 * Generate a new QR session for device linking
 * Called by outlet TV APK when it needs to display a QR code
 */
router.post("/generate-qr-session", async (req: Request, res: Response) => {
  try {
    const { outletId, deviceId, deviceName } = req.body

    // Validate required fields
    if (!outletId || !deviceId || !deviceName) {
      return res.status(400).json({
        error: "Missing required fields: outletId, deviceId, and deviceName are required"
      })
    }

    // Generate QR session
    const session = await qrSessionService.generateSession({
      outletId,
      deviceId,
      deviceName
    })

    if (!session) {
      return res.status(500).json({
        error: "Failed to generate QR session"
      })
    }

    console.log(`📱 QR session generated for device:`, {
      sessionId: session.sessionId,
      deviceId,
      deviceName,
      outletId
    })

    res.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        qrToken: session.qrToken,
        qrData: `${session.sessionId}:${session.qrToken}`, // Combined data for QR code
        expiresAt: session.expiresAt,
        expiresIn: Math.floor((session.expiresAt.getTime() - Date.now()) / 1000) // seconds
      }
    })

  } catch (error: any) {
    console.error("❌ Generate QR session error:", error)
    
    if (error.message === 'Rate limit exceeded. Please wait before generating another QR code.') {
      return res.status(429).json({
        error: error.message,
        retryAfter: 60 // seconds
      })
    }

    res.status(500).json({
      error: "Failed to generate QR session",
      details: error.message
    })
  }
})

/**
 * GET /api/outlet/link-status
 * Check if device is linked and get link information
 * Called by outlet TV APK to check current link status
 */
router.get("/link-status", async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.query

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        error: "Missing or invalid deviceId parameter"
      })
    }

    // Check device link status
    const deviceLink = await deviceLinkService.getLink(deviceId)

    if (!deviceLink) {
      return res.json({
        linked: false,
        status: 'not_linked'
      })
    }

    // Check if device is currently connected via WebSocket
    const isConnected = wsManager.isDeviceConnected(deviceId)

    res.json({
      linked: true,
      status: deviceLink.status,
      device: {
        id: deviceLink.deviceId,
        name: deviceLink.deviceName,
        macAddress: deviceLink.macAddress,
        linkedAt: deviceLink.linkedAt,
        lastSeenAt: deviceLink.lastSeenAt
      },
      outlet: deviceLink.outlet,
      websocketConnected: isConnected
    })

  } catch (error: any) {
    console.error("❌ Link status check error:", error)
    res.status(500).json({
      error: "Failed to check link status",
      details: error.message
    })
  }
})

/**
 * DELETE /api/outlet/unlink-device
 * Unlink device (APK-initiated logout)
 * Called by outlet TV APK when user wants to reset configuration
 */
router.delete("/unlink-device", async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body

    if (!deviceId) {
      return res.status(400).json({
        error: "Missing required field: deviceId"
      })
    }

    // Get device link before unlinking
    const deviceLink = await deviceLinkService.getLink(deviceId)
    
    if (!deviceLink) {
      return res.status(404).json({
        error: "Device not linked"
      })
    }

    // Unlink the device
    const success = await deviceLinkService.unlinkDevice(deviceId, 'device_logout')

    if (!success) {
      return res.status(500).json({
        error: "Failed to unlink device"
      })
    }

    // Broadcast unlink event to manager dashboard (if connected)
    wsManager.broadcast({
      type: "DEVICE_UNLINKED",
      data: {
        deviceId: deviceId,
        deviceName: deviceLink.deviceName,
        outletId: deviceLink.outletId,
        unlinkedBy: 'device',
        unlinkedAt: new Date().toISOString()
      },
      targetManagerId: deviceLink.managerId
    })

    console.log(`📱 Device unlinked by APK:`, {
      deviceId,
      deviceName: deviceLink.deviceName,
      outletId: deviceLink.outletId
    })

    res.json({
      success: true,
      message: "Device unlinked successfully"
    })

  } catch (error: any) {
    console.error("❌ Unlink device error:", error)
    res.status(500).json({
      error: "Failed to unlink device",
      details: error.message
    })
  }
})

/**
 * POST /api/outlet/heartbeat
 * Update device heartbeat timestamp
 * Called periodically by outlet TV APK to indicate it's alive
 */
router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body

    if (!deviceId) {
      return res.status(400).json({
        error: "Missing required field: deviceId"
      })
    }

    // Update device heartbeat
    const success = await deviceLinkService.updateHeartbeat(deviceId)

    if (!success) {
      // Device might not be linked
      return res.status(404).json({
        error: "Device not linked",
        action: "relink_required"
      })
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error("❌ Heartbeat error:", error)
    res.status(500).json({
      error: "Failed to update heartbeat",
      details: error.message
    })
  }
})

/**
 * GET /api/outlet/session-status/:sessionId
 * Check QR session status (for polling if WebSocket is not available)
 * Called by outlet TV APK to check if QR was scanned/approved
 */
router.get("/session-status/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params

    if (!sessionId) {
      return res.status(400).json({
        error: "Missing sessionId parameter"
      })
    }

    // Get session status
    const session = await qrSessionService.getSession(sessionId)

    if (!session) {
      return res.status(404).json({
        error: "Session not found"
      })
    }

    // Check if expired
    if (new Date() > session.expiresAt && session.status === 'pending') {
      await qrSessionService.updateSessionStatus({
        sessionId: sessionId,
        status: 'expired',
        unlinkedReason: 'token_expired'
      })
      
      return res.json({
        status: 'expired',
        message: 'QR session has expired'
      })
    }

    // Return session status
    res.json({
      status: session.status,
      sessionId: session.sessionId,
      scannedAt: session.scannedAt,
      linkedAt: session.linkedAt,
      outlet: session.outlet,
      expiresAt: session.expiresAt
    })

  } catch (error: any) {
    console.error("❌ Session status check error:", error)
    res.status(500).json({
      error: "Failed to check session status",
      details: error.message
    })
  }
})

/**
 * GET /api/outlet/setup-status
 * Fast polling endpoint for OLD QR setup flow (setupCode-based)
 * Called by outlet TV APK to check if device is configured
 * Query params: deviceId, setupCode
 */
router.get("/setup-status", async (req: Request, res: Response) => {
  try {
    const { deviceId, setupCode } = req.query

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        error: "Missing deviceId parameter"
      })
    }

    // Query outlets to find device in displaySettings
    const outlets = await prisma.outlet.findMany({
      where: {
        isActive: true
      },
      select: {
        id: true,
        name: true,
        location: true,
        displaySettings: true
      }
    })

    // Find the device in displaySettings
    for (const outlet of outlets) {
      const settings = outlet.displaySettings as any
      const linkedDevices = settings?.linkedDevices || []
      const device = linkedDevices.find((d: any) => d.deviceId === deviceId)
      
      if (device && device.isActive) {
        // Also check if it matches setupCode if provided
        if (setupCode && device.setupCode !== setupCode) {
          continue
        }

        return res.json({
          configured: true,
          device: device,
          outlet: {
            id: outlet.id,
            name: outlet.name,
            location: outlet.location
          },
          timestamp: new Date().toISOString()
        })
      }
    }

    // Not configured yet
    res.json({
      configured: false,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error("❌ Setup status check error:", error)
    res.status(500).json({
      error: "Failed to check setup status",
      details: error.message
    })
  }
})

export default router
