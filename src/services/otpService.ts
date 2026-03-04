import { prisma } from '../server'
import sltSmsService from './sltSmsService'

export type UserType = 'officer' | 'teleshop_manager' | 'rtom' | 'gm' | 'dgm'

interface OTPGenerationResult {
  success: boolean
  message: string
  otpId?: string
}

interface OTPVerificationResult {
  success: boolean
  message: string
  userId?: string
}

class OTPService {
  private readonly OTP_LENGTH = 4
  private readonly OTP_EXPIRY_MINUTES = 5
  private readonly MAX_ATTEMPTS = 3

  /**
   * Generate a random 4-digit OTP code
   */
  private generateOTPCode(): string {
    return Math.floor(1000 + Math.random() * 9000).toString()
  }

  /**
   * Generate and send OTP to user's mobile number
   */
  async generateOTP(mobileNumber: string, userType: UserType, userName?: string): Promise<OTPGenerationResult> {
    try {
      // Generate OTP code
      const otpCode = this.generateOTPCode()
      const expiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000)

      // Delete any existing unverified OTPs for this mobile number and user type
      await prisma.oTP.deleteMany({
        where: {
          mobileNumber,
          userType,
          verified: false
        }
      })

      // Create new OTP record
      const otp = await prisma.oTP.create({
        data: {
          mobileNumber,
          otpCode,
          userType,
          expiresAt,
          verified: false,
          attempts: 0
        }
      })

      // Send OTP via SMS with user type and name for personalized message
      const smsResult = await sltSmsService.sendOTP(mobileNumber, otpCode, userType, userName, 'en')

      if (!smsResult.success) {
        console.error(`Failed to send OTP SMS to ${mobileNumber}:`, smsResult.error)
        // Still return success if OTP was created, but log the SMS failure
        // In production, you might want to handle this differently
      }

      console.log(`OTP generated for ${userType} ${mobileNumber}: ${otpCode} (DEBUG ONLY - Remove in production)`)

      return {
        success: true,
        message: `OTP sent to ${mobileNumber}. Valid for ${this.OTP_EXPIRY_MINUTES} minutes.`,
        otpId: otp.id
      }
    } catch (error: any) {
      console.error('Error generating OTP:', error)
      return {
        success: false,
        message: 'Failed to generate OTP. Please try again.'
      }
    }
  }

  /**
   * Verify OTP code for a user
   */
  async verifyOTP(mobileNumber: string, otpCode: string, userType: UserType): Promise<OTPVerificationResult> {
    try {
      // Find the most recent unverified OTP for this mobile number and user type
      const otp = await prisma.oTP.findFirst({
        where: {
          mobileNumber,
          userType,
          verified: false
        },
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (!otp) {
        return {
          success: false,
          message: 'No OTP found. Please request a new one.'
        }
      }

      // Check if OTP has expired
      if (new Date() > otp.expiresAt) {
        await prisma.oTP.delete({ where: { id: otp.id } })
        return {
          success: false,
          message: 'OTP has expired. Please request a new one.'
        }
      }

      // Check if max attempts exceeded
      if (otp.attempts >= this.MAX_ATTEMPTS) {
        await prisma.oTP.delete({ where: { id: otp.id } })
        return {
          success: false,
          message: 'Maximum verification attempts exceeded. Please request a new OTP.'
        }
      }

      // Increment attempts
      await prisma.oTP.update({
        where: { id: otp.id },
        data: { attempts: otp.attempts + 1 }
      })

      // Verify OTP code
      if (otp.otpCode !== otpCode) {
        const remainingAttempts = this.MAX_ATTEMPTS - (otp.attempts + 1)
        return {
          success: false,
          message: `Invalid OTP. ${remainingAttempts} attempt(s) remaining.`
        }
      }

      // Mark OTP as verified
      await prisma.oTP.update({
        where: { id: otp.id },
        data: { verified: true }
      })

      // Get user ID based on user type
      let userId: string | undefined

      switch (userType) {
        case 'officer':
          const officer = await prisma.officer.findUnique({
            where: { mobileNumber },
            select: { id: true }
          })
          userId = officer?.id
          break

        case 'teleshop_manager':
          const teleshopManager = await prisma.teleshopManager.findUnique({
            where: { mobileNumber },
            select: { id: true }
          })
          userId = teleshopManager?.id
          break

        case 'rtom':
          const region = await prisma.region.findFirst({
            where: { managerMobile: mobileNumber },
            select: { managerId: true }
          })
          userId = region?.managerId || undefined
          break

        case 'gm':
          const gm = await (prisma as any).gM.findFirst({
            where: { mobileNumber },
            select: { id: true }
          })
          userId = gm?.id
          break

        case 'dgm':
          const dgm = await (prisma as any).dGM.findFirst({
            where: { mobileNumber },
            select: { id: true }
          })
          userId = dgm?.id
          break
      }

      // Clean up old verified OTPs (optional, for housekeeping)
      await prisma.oTP.deleteMany({
        where: {
          mobileNumber,
          userType,
          verified: true,
          createdAt: {
            lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Older than 24 hours
          }
        }
      })

      return {
        success: true,
        message: 'OTP verified successfully',
        userId
      }
    } catch (error: any) {
      console.error('Error verifying OTP:', error)
      return {
        success: false,
        message: 'Failed to verify OTP. Please try again.'
      }
    }
  }

  /**
   * Cleanup expired OTPs (can be called periodically)
   */
  async cleanupExpiredOTPs(): Promise<void> {
    try {
      const result = await prisma.oTP.deleteMany({
        where: {
          expiresAt: {
            lt: new Date()
          }
        }
      })
      console.log(`Cleaned up ${result.count} expired OTP(s)`)
    } catch (error) {
      console.error('Error cleaning up expired OTPs:', error)
    }
  }
}

export default new OTPService()
