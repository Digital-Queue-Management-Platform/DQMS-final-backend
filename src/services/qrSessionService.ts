/**
 * QR Session Service - Manages QR code session lifecycle for device linking
 * Implements WhatsApp Web-style temporary session tokens
 */

import { PrismaClient } from "@prisma/client"
import { randomUUID } from "crypto"

const prisma = new PrismaClient()

// Rate limiting store (in-memory, can be moved to Redis for distributed systems)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

interface QRSessionData {
  sessionId: string
  qrToken: string
  outletId: string
  expiresAt: Date
  status: string
}

interface GenerateSessionParams {
  outletId: string
  deviceId: string
  deviceName: string
}

interface UpdateSessionParams {
  sessionId: string
  status: 'pending' | 'scanned' | 'linked' | 'expired' | 'rejected' | 'unlinked'
  scannedByManagerId?: string
  linkedManagerId?: string
  linkedDeviceId?: string
  unlinkedBy?: string
  unlinkedReason?: string
}

export class QRSessionService {
  
  /**
   * Generate a unique QR token (similar to WhatsApp Web)
   */
  private generateQRToken(): string {
    // Generate a secure random token (24 chars)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let token = ''
    for (let i = 0; i < 24; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return token
  }

  /**
   * Check rate limit for QR generation
   */
  private checkRateLimit(deviceId: string, maxRequests: number = 10, windowMs: number = 60000): boolean {
    const now = Date.now()
    const record = rateLimitStore.get(deviceId)

    if (!record || now > record.resetAt) {
      // Create new window
      rateLimitStore.set(deviceId, {
        count: 1,
        resetAt: now + windowMs
      })
      return true
    }

    if (record.count >= maxRequests) {
      console.warn(`⚠️  Rate limit exceeded for device: ${deviceId}`)
      return false
    }

    record.count++
    return true
  }

  /**
   * Generate a new QR session
   */
  async generateSession(params: GenerateSessionParams): Promise<QRSessionData | null> {
    const { outletId, deviceId, deviceName } = params

    // Check rate limit (max 10 QR generations per minute per device)
    if (!this.checkRateLimit(deviceId, 10, 60000)) {
      throw new Error('Rate limit exceeded. Please wait before generating another QR code.')
    }

    // Verify outlet exists
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { id: true, name: true, isActive: true }
    })

    if (!outlet) {
      throw new Error('Outlet not found')
    }

    if (!outlet.isActive) {
      throw new Error('Outlet is not active')
    }

    // Expire any existing pending sessions for this device
    await prisma.qRSession.updateMany({
      where: {
        outletId: outletId,
        deviceId: deviceId,
        status: 'pending'
      },
      data: {
        status: 'expired',
        unlinkedReason: 'new_session_generated'
      }
    })

    // Generate new session
    const sessionId = randomUUID()
    const qrToken = this.generateQRToken()
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000) // 2 minutes

    try {
      const session = await prisma.qRSession.create({
        data: {
          sessionId: sessionId,
          qrToken: qrToken,
          outletId: outletId,
          deviceId: deviceId,
          deviceName: deviceName,
          status: 'pending',
          expiresAt: expiresAt,
          generatedAt: new Date()
        }
      })

      console.log(`✅ QR session generated:`, {
        sessionId,
        outletId,
        deviceId,
        expiresIn: '2 minutes'
      })

      return {
        sessionId: session.sessionId,
        qrToken: session.qrToken,
        outletId: session.outletId,
        expiresAt: session.expiresAt,
        status: session.status
      }
    } catch (error: any) {
      console.error(`❌ Failed to generate QR session:`, error.message)
      throw new Error('Failed to generate QR session')
    }
  }

  /**
   * Validate QR token and return session data
   */
  async validateQRToken(qrToken: string): Promise<any | null> {
    try {
      const session = await prisma.qRSession.findUnique({
        where: { qrToken: qrToken },
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

      if (!session) {
        return null
      }

      // Check if expired
      if (new Date() > session.expiresAt) {
        // Mark as expired if not already
        if (session.status === 'pending') {
          await this.updateSessionStatus({
            sessionId: session.sessionId,
            status: 'expired',
            unlinkedReason: 'token_expired'
          })
        }
        return null
      }

      // Only valid if status is pending
      if (session.status !== 'pending') {
        return null
      }

      return session
    } catch (error: any) {
      console.error(`❌ Failed to validate QR token:`, error.message)
      return null
    }
  }

  /**
   * Update session status
   */
  async updateSessionStatus(params: UpdateSessionParams): Promise<boolean> {
    const { sessionId, status, ...updateData } = params

    try {
      const data: any = {
        status: status,
        ...updateData
      }

      // Set timestamps based on status
      if (status === 'scanned' && !data.scannedAt) {
        data.scannedAt = new Date()
      }
      if (status === 'linked' && !data.linkedAt) {
        data.linkedAt = new Date()
      }
      if (status === 'unlinked' && !data.unlinkedAt) {
        data.unlinkedAt = new Date()
      }

      await prisma.qRSession.update({
        where: { sessionId: sessionId },
        data: data
      })

      console.log(`✅ Session status updated:`, { sessionId, status })
      return true
    } catch (error: any) {
      console.error(`❌ Failed to update session status:`, error.message)
      return false
    }
  }

  /**
   * Get active session by sessionId
   */
  async getSession(sessionId: string): Promise<any | null> {
    try {
      const session = await prisma.qRSession.findUnique({
        where: { sessionId: sessionId },
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

      return session
    } catch (error: any) {
      console.error(`❌ Failed to get session:`, error.message)
      return null
    }
  }

  /**
   * Get active session for a device
   */
  async getActiveSession(deviceId: string): Promise<any | null> {
    try {
      const session = await prisma.qRSession.findFirst({
        where: {
          deviceId: deviceId,
          status: {
            in: ['pending', 'scanned', 'linked']
          },
          expiresAt: {
            gt: new Date()
          }
        },
        orderBy: {
          generatedAt: 'desc'
        }
      })

      return session
    } catch (error: any) {
      console.error(`❌ Failed to get active session:`, error.message)
      return null
    }
  }

  /**
   * Expire old sessions (cleanup job)
   */
  async expireOldSessions(): Promise<number> {
    try {
      const result = await prisma.qRSession.updateMany({
        where: {
          status: 'pending',
          expiresAt: {
            lt: new Date()
          }
        },
        data: {
          status: 'expired',
          unlinkedReason: 'token_expired'
        }
      })

      if (result.count > 0) {
        console.log(`🧹 Expired ${result.count} old QR session(s)`)
      }

      return result.count
    } catch (error: any) {
      console.error(`❌ Failed to expire old sessions:`, error.message)
      return 0
    }
  }

  /**
   * Cleanup old sessions (delete sessions older than 24 hours)
   */
  async cleanupOldSessions(): Promise<number> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      const result = await prisma.qRSession.deleteMany({
        where: {
          generatedAt: {
            lt: oneDayAgo
          },
          status: {
            in: ['expired', 'rejected', 'unlinked']
          }
        }
      })

      if (result.count > 0) {
        console.log(`🧹 Cleaned up ${result.count} old QR session(s)`)
      }

      return result.count
    } catch (error: any) {
      console.error(`❌ Failed to cleanup old sessions:`, error.message)
      return 0
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    total: number
    pending: number
    scanned: number
    linked: number
    expired: number
    rejected: number
  }> {
    try {
      const [total, pending, scanned, linked, expired, rejected] = await Promise.all([
        prisma.qRSession.count(),
        prisma.qRSession.count({ where: { status: 'pending' } }),
        prisma.qRSession.count({ where: { status: 'scanned' } }),
        prisma.qRSession.count({ where: { status: 'linked' } }),
        prisma.qRSession.count({ where: { status: 'expired' } }),
        prisma.qRSession.count({ where: { status: 'rejected' } })
      ])

      return { total, pending, scanned, linked, expired, rejected }
    } catch (error: any) {
      console.error(`❌ Failed to get session stats:`, error.message)
      return { total: 0, pending: 0, scanned: 0, linked: 0, expired: 0, rejected: 0 }
    }
  }
}

// Singleton instance
export const qrSessionService = new QRSessionService()
