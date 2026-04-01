/**
 * Device Link Service - Manages persistent device-manager link relationships
 * Tracks active device connections and their configurations
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

interface CreateDeviceLinkParams {
  deviceId: string
  deviceName: string
  macAddress?: string
  outletId: string
  managerId: string
  configData?: any
  metadata?: any
}

interface UpdateDeviceLinkParams {
  deviceId: string
  status?: 'active' | 'inactive' | 'suspended'
  lastSeenAt?: Date
  lastHeartbeatAt?: Date
  configData?: any
  metadata?: any
}

export class DeviceLinkService {

  /**
   * Create a new device link (when device is approved by manager)
   */
  async createLink(params: CreateDeviceLinkParams): Promise<any> {
    const { deviceId, deviceName, macAddress, outletId, managerId, configData, metadata } = params

    try {
      // Check if device already exists
      const existingLink = await prisma.deviceLink.findUnique({
        where: { deviceId: deviceId }
      })

      if (existingLink) {
        // Update existing link instead of creating new
        return await this.updateLink({
          deviceId: deviceId,
          status: 'active',
          lastSeenAt: new Date(),
          configData: configData,
          metadata: metadata
        })
      }

      // Create new device link
      const deviceLink = await prisma.deviceLink.create({
        data: {
          deviceId: deviceId,
          deviceName: deviceName,
          macAddress: macAddress,
          outletId: outletId,
          managerId: managerId,
          status: 'active',
          linkedAt: new Date(),
          lastSeenAt: new Date(),
          configData: configData,
          metadata: metadata
        },
        include: {
          outlet: {
            select: {
              id: true,
              name: true,
              location: true
            }
          }
        }
      })

      console.log(`✅ Device link created:`, {
        deviceId,
        deviceName,
        outletId,
        managerId
      })

      return deviceLink
    } catch (error: any) {
      console.error(`❌ Failed to create device link:`, error.message)
      throw new Error('Failed to create device link')
    }
  }

  /**
   * Update device link information
   */
  async updateLink(params: UpdateDeviceLinkParams): Promise<any> {
    const { deviceId, ...updateData } = params

    try {
      const deviceLink = await prisma.deviceLink.update({
        where: { deviceId: deviceId },
        data: updateData,
        include: {
          outlet: {
            select: {
              id: true,
              name: true,
              location: true
            }
          }
        }
      })

      console.log(`✅ Device link updated:`, { deviceId, updates: Object.keys(updateData) })

      return deviceLink
    } catch (error: any) {
      console.error(`❌ Failed to update device link:`, error.message)
      throw new Error('Failed to update device link')
    }
  }

  /**
   * Unlink device (soft delete by setting status to inactive)
   */
  async unlinkDevice(deviceId: string, reason?: string): Promise<boolean> {
    try {
      await prisma.deviceLink.update({
        where: { deviceId: deviceId },
        data: {
          status: 'inactive',
          unlinkedAt: new Date(),
          metadata: {
            unlinkedReason: reason || 'manual_unlink'
          }
        }
      })

      console.log(`✅ Device unlinked:`, { deviceId, reason })
      return true
    } catch (error: any) {
      console.error(`❌ Failed to unlink device:`, error.message)
      return false
    }
  }

  /**
   * Delete device link permanently
   */
  async deleteLink(deviceId: string): Promise<boolean> {
    try {
      await prisma.deviceLink.delete({
        where: { deviceId: deviceId }
      })

      console.log(`✅ Device link deleted:`, { deviceId })
      return true
    } catch (error: any) {
      console.error(`❌ Failed to delete device link:`, error.message)
      return false
    }
  }

  /**
   * Get device link by deviceId
   */
  async getLink(deviceId: string): Promise<any | null> {
    try {
      const deviceLink = await prisma.deviceLink.findUnique({
        where: { deviceId: deviceId },
        include: {
          outlet: {
            select: {
              id: true,
              name: true,
              location: true,
              regionId: true
            }
          }
        }
      })

      return deviceLink
    } catch (error: any) {
      console.error(`❌ Failed to get device link:`, error.message)
      return null
    }
  }

  /**
   * Check if device is linked and active
   */
  async isDeviceLinked(deviceId: string): Promise<boolean> {
    try {
      const deviceLink = await prisma.deviceLink.findUnique({
        where: { deviceId: deviceId },
        select: { status: true }
      })

      return deviceLink !== null && deviceLink.status === 'active'
    } catch (error: any) {
      console.error(`❌ Failed to check device link status:`, error.message)
      return false
    }
  }

  /**
   * Get all devices linked to an outlet
   */
  async getOutletDevices(outletId: string, activeOnly: boolean = true): Promise<any[]> {
    try {
      const devices = await prisma.deviceLink.findMany({
        where: {
          outletId: outletId,
          ...(activeOnly ? { status: 'active' } : {})
        },
        orderBy: {
          linkedAt: 'desc'
        }
      })

      return devices
    } catch (error: any) {
      console.error(`❌ Failed to get outlet devices:`, error.message)
      return []
    }
  }

  /**
   * Get all devices managed by a specific manager
   */
  async getManagerDevices(managerId: string, activeOnly: boolean = true): Promise<any[]> {
    try {
      const devices = await prisma.deviceLink.findMany({
        where: {
          managerId: managerId,
          ...(activeOnly ? { status: 'active' } : {})
        },
        include: {
          outlet: {
            select: {
              id: true,
              name: true,
              location: true
            }
          }
        },
        orderBy: {
          linkedAt: 'desc'
        }
      })

      return devices
    } catch (error: any) {
      console.error(`❌ Failed to get manager devices:`, error.message)
      return []
    }
  }

  /**
   * Update device heartbeat timestamp
   */
  async updateHeartbeat(deviceId: string): Promise<boolean> {
    try {
      await prisma.deviceLink.update({
        where: { deviceId: deviceId },
        data: {
          lastHeartbeatAt: new Date(),
          lastSeenAt: new Date()
        }
      })

      return true
    } catch (error: any) {
      console.error(`❌ Failed to update device heartbeat:`, error.message)
      return false
    }
  }

  /**
   * Mark devices as inactive if no heartbeat for specified duration
   */
  async markStaleDevicesInactive(inactiveThresholdMs: number = 5 * 60 * 1000): Promise<number> {
    try {
      const thresholdTime = new Date(Date.now() - inactiveThresholdMs)

      const result = await prisma.deviceLink.updateMany({
        where: {
          status: 'active',
          OR: [
            {
              lastHeartbeatAt: {
                lt: thresholdTime
              }
            },
            {
              lastHeartbeatAt: null,
              lastSeenAt: {
                lt: thresholdTime
              }
            }
          ]
        },
        data: {
          status: 'inactive',
          metadata: {
            inactiveReason: 'no_heartbeat',
            markedInactiveAt: new Date().toISOString()
          }
        }
      })

      if (result.count > 0) {
        console.log(`⚠️  Marked ${result.count} stale device(s) as inactive`)
      }

      return result.count
    } catch (error: any) {
      console.error(`❌ Failed to mark stale devices inactive:`, error.message)
      return 0
    }
  }

  /**
   * Get device link statistics
   */
  async getLinkStats(): Promise<{
    total: number
    active: number
    inactive: number
    suspended: number
  }> {
    try {
      const [total, active, inactive, suspended] = await Promise.all([
        prisma.deviceLink.count(),
        prisma.deviceLink.count({ where: { status: 'active' } }),
        prisma.deviceLink.count({ where: { status: 'inactive' } }),
        prisma.deviceLink.count({ where: { status: 'suspended' } })
      ])

      return { total, active, inactive, suspended }
    } catch (error: any) {
      console.error(`❌ Failed to get link stats:`, error.message)
      return { total: 0, active: 0, inactive: 0, suspended: 0 }
    }
  }

  /**
   * Cleanup old inactive device links (delete devices inactive for more than 30 days)
   */
  async cleanupInactiveLinks(daysInactive: number = 30): Promise<number> {
    try {
      const thresholdDate = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000)

      const result = await prisma.deviceLink.deleteMany({
        where: {
          status: 'inactive',
          unlinkedAt: {
            lt: thresholdDate
          }
        }
      })

      if (result.count > 0) {
        console.log(`🧹 Cleaned up ${result.count} old inactive device link(s)`)
      }

      return result.count
    } catch (error: any) {
      console.error(`❌ Failed to cleanup inactive links:`, error.message)
      return 0
    }
  }
}

// Singleton instance
export const deviceLinkService = new DeviceLinkService()
