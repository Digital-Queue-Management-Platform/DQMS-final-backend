/**
 * Outlet Display APK Routes
 * Handles QR setup and device linking for outlet TV displays
 * 
 * SIMPLIFIED VERSION: Uses existing ManagerQRToken table and Outlet.displaySettings
 * This avoids the Prisma issues with QRSession/DeviceLink tables
 */

import express, { Request, Response } from "express"
import { PrismaClient } from "@prisma/client"
import { wsManager, OUTLET_DEVICES_ROOM } from "../services/wsManager"

const router = express.Router()
const prisma = new PrismaClient()

// In-memory store for pending QR registrations (deviceId -> { setupCode, connectedAt })
const pendingDevices = new Map<string, { setupCode: string; connectedAt: Date }>()

/**
 * POST /api/outlet/register-qr
 * Register APK's QR code for manager scanning
 * Called by outlet TV APK when it generates a QR code
 */
router.post("/register-qr", async (req: Request, res: Response) => {
  try {
    const { setupCode, deviceId, deviceName } = req.body

    if (!setupCode || !deviceId) {
      return res.status(400).json({
        error: "Missing required fields: setupCode and deviceId are required"
      })
    }

    // Store in memory for quick lookup
    pendingDevices.set(deviceId, {
      setupCode,
      connectedAt: new Date()
    })

    console.log(`📱 APK registered QR code: ${setupCode} for device: ${deviceId}`)

    res.json({
      success: true,
      message: "QR code registered, waiting for manager scan",
      setupCode: setupCode,
      deviceId: deviceId
    })

  } catch (error: any) {
    console.error("❌ Register QR error:", error)
    res.status(500).json({
      error: "Failed to register QR code",
      details: error.message
    })
  }
})

/**
 * GET /api/outlet/link-status
 * Check if device is linked and get link information
 * Uses Outlet.displaySettings.linkedDevices
 */
router.get("/link-status", async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.query

    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        error: "Missing or invalid deviceId parameter"
      })
    }

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
      const device = linkedDevices.find((d: any) => d.deviceId === deviceId)
      
      if (device && device.isActive) {
        return res.json({
          linked: true,
          status: 'active',
          device: {
            id: device.deviceId,
            name: device.deviceName,
            macAddress: device.macAddress,
            linkedAt: device.configuredAt,
            lastSeenAt: device.lastSeen
          },
          outlet: {
            id: outlet.id,
            name: outlet.name,
            location: outlet.location
          },
          websocketConnected: wsManager.isDeviceConnected(deviceId)
        })
      }
    }

    return res.json({
      linked: false,
      status: 'not_linked'
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
 * Removes device from Outlet.displaySettings.linkedDevices
 */
router.delete("/unlink-device", async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body

    if (!deviceId) {
      return res.status(400).json({
        error: "Missing required field: deviceId"
      })
    }

    // Find device in outlets
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        displaySettings: true
      }
    })

    let foundOutlet = null
    let foundDevice = null

    for (const outlet of outlets) {
      const settings = outlet.displaySettings as any
      const linkedDevices = settings?.linkedDevices || []
      const device = linkedDevices.find((d: any) => d.deviceId === deviceId)
      
      if (device) {
        foundOutlet = outlet
        foundDevice = device
        break
      }
    }

    if (!foundOutlet || !foundDevice) {
      return res.status(404).json({
        error: "Device not linked"
      })
    }

    // Remove device from displaySettings
    const settings = foundOutlet.displaySettings as any
    const filteredDevices = (settings?.linkedDevices || []).filter((d: any) => d.deviceId !== deviceId)
    
    await prisma.outlet.update({
      where: { id: foundOutlet.id },
      data: {
        displaySettings: {
          ...settings,
          linkedDevices: filteredDevices
        }
      }
    })

    // Broadcast unlink event to manager dashboard
    wsManager.broadcast({
      type: "DEVICE_UNLINKED",
      data: {
        deviceId: deviceId,
        deviceName: foundDevice.deviceName,
        outletId: foundOutlet.id,
        unlinkedBy: 'device',
        unlinkedAt: new Date().toISOString()
      }
    })

    // Remove from pending devices
    pendingDevices.delete(deviceId)

    console.log(`📱 Device unlinked by APK:`, {
      deviceId,
      deviceName: foundDevice.deviceName,
      outletId: foundOutlet.id
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
 * Update device heartbeat/lastSeen timestamp
 */
router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body

    if (!deviceId) {
      return res.status(400).json({
        error: "Missing required field: deviceId"
      })
    }

    // Find and update device lastSeen in displaySettings
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: {
        id: true,
        displaySettings: true
      }
    })

    for (const outlet of outlets) {
      const settings = outlet.displaySettings as any
      const linkedDevices = settings?.linkedDevices || []
      const deviceIndex = linkedDevices.findIndex((d: any) => d.deviceId === deviceId)
      
      if (deviceIndex !== -1) {
        // Update lastSeen
        linkedDevices[deviceIndex].lastSeen = new Date().toISOString()
        
        await prisma.outlet.update({
          where: { id: outlet.id },
          data: {
            displaySettings: {
              ...settings,
              linkedDevices: linkedDevices
            }
          }
        })

        return res.json({
          success: true,
          timestamp: new Date().toISOString()
        })
      }
    }

    // Device not found
    return res.status(404).json({
      error: "Device not linked",
      action: "relink_required"
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
 * GET /api/outlet/setup-status
 * Fast polling endpoint to check if device is configured
 * Query params: deviceId, setupCode (optional)
 * 
 * This is the PRIMARY endpoint for APK to check if QR has been scanned
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
      where: { isActive: true },
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

/**
 * Export pending devices map for use in WebSocket handler
 */
export const getPendingDevices = () => pendingDevices

export default router
