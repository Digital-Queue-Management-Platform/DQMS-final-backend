import sltSmsService from '../services/sltSmsService'

export type SMSProvider = 'slt'

interface SendSMSOptions {
  to: string
  body: string
  language?: 'en' | 'si' | 'ta'
}

interface SendSMSResult {
  success: boolean
  provider?: string
  error?: string
  messageId?: string
}

/**
 * Unified SMS helper that supports SLT SMS gateway
 */
class UnifiedSmsHelper {
  /**
   * Check if SLT SMS is configured
   */
  isSltConfigured(): boolean {
    return sltSmsService.isConfigured()
  }

  /**
   * Send SMS using SLT SMS provider
   */
  async sendSMS(options: SendSMSOptions): Promise<SendSMSResult> {
    const { to, body } = options

    // Development mode check
    const OTP_DEV_MODE = process.env.OTP_DEV_MODE === "true"
    if (OTP_DEV_MODE) {
      console.log(`[SMS][DEV] Message to ${to}: ${body}`)
      return { success: true, provider: 'dev' }
    }

    if (this.isSltConfigured()) {
      try {
        const result = await sltSmsService.sendSMS({ to, message: body })
        if (result.success) {
          console.log(`[SMS] Sent via SLT SMS to ${to}`)
          return { success: true, provider: 'slt', messageId: result.messageId }
        } else {
          console.warn(`[SMS] SLT SMS failed: ${result.error}`)
          return { success: false, provider: 'slt', error: result.error }
        }
      } catch (error: any) {
        console.error('[SMS] SLT SMS error:', error.message)
        return { success: false, provider: 'slt', error: error.message }
      }
    }

    // No provider configured
    return {
      success: false,
      error: 'SLT SMS provider not configured properly.'
    }
  }

  /**
   * Send OTP SMS
   */
  async sendOTP(mobileNumber: string, otpCode: string, language: 'en' | 'si' | 'ta' = 'en'): Promise<SendSMSResult> {
    // Always send OTP in English (plain ASCII) regardless of preferred language.
    // Unicode SMS (Sinhala/Tamil) is limited to 70 chars per segment and many gateways
    // do not reliably deliver multi-part Unicode SMS, causing OTPs to be silently lost.
    const message = `Dear Valued Customer\n\nYour verification code is ${otpCode}. Valid for 5 minutes.\n\nSLT-MOBITEL`

    return this.sendSMS({
      to: mobileNumber,
      body: message,
      language: 'en'
    })
  }

  /**
   * Send appointment confirmation SMS
   */
  async sendAppointmentConfirmation(
    mobileNumber: string,
    details: {
      name: string
      outletName: string
      dateTime: string
      services: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SendSMSResult> {
    // Since SMS doesn't support Unicode properly, use English for all languages
    const messageText = `Dear Valued Customer\n\nYour appointment at ${details.outletName} is confirmed for ${details.dateTime}.\n\nSLT-MOBITEL`

    return this.sendSMS({
      to: mobileNumber,
      body: messageText,
      language: 'en'
    })
  }

  /**
   * Send token notification
   */
  async sendTokenNotification(
    mobileNumber: string,
    tokenNumber: number,
    counterNumber: number,
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SendSMSResult> {
    const formattedToken = tokenNumber.toString().padStart(3, '0')
    // Since SMS doesn't support Unicode properly, use English for all languages
    const messageText = `Dear Valued Customer\n\nYour token number ${formattedToken} is now being called. Please proceed to Counter ${counterNumber}.\n\nSLT-MOBITEL`

    return this.sendSMS({
      to: mobileNumber,
      body: messageText,
      language: 'en'
    })
  }

  /**
   * Send bill payment notification
   */
  async sendBillNotification(
    mobileNumber: string,
    details: {
      accountName: string
      amount: string
      dueDate: string
      accountNumber: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SendSMSResult> {
    // Since SMS doesn't support Unicode properly, use English for all languages
    const messageText = `Dear Valued Customer\n\nYour SLT account ${details.accountNumber} has an outstanding balance of Rs. ${details.amount}. Please settle the bill by ${details.dueDate} to avoid service interruption.\n\nSLT-MOBITEL`

    return this.sendSMS({
      to: mobileNumber,
      body: messageText,
      language: 'en'
    })
  }

  /**
   * Send registration confirmation
   */
  async sendRegistrationConfirmation(
    mobileNumber: string,
    details: {
      name: string
      tokenNumber: number
      outletName: string
      estimatedWait: number
      position?: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SendSMSResult> {
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    // Since SMS doesn't support Unicode properly, use English for all languages
    const messageText = `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active (Queue Position: ${details.position || 1}).\n\nSLT-MOBITEL`

    return this.sendSMS({
      to: mobileNumber,
      body: messageText,
      language: 'en'
    })
  }

  /**
   * Send token cancellation confirmation
   */
  async sendTokenCancellation(
    mobileNumber: string,
    details: {
      tokenNumber: number
      outletName: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SendSMSResult> {
    const result = await sltSmsService.sendTokenCancellation(mobileNumber, details, language)
    return { success: result.success, provider: 'slt', error: result.error, messageId: result.messageId }
  }

  /**
   * Send appointment cancellation confirmation
   */
  async sendAppointmentCancellation(
    mobileNumber: string,
    details: {
      outletName: string
      dateTime: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SendSMSResult> {
    const result = await sltSmsService.sendAppointmentCancellation(mobileNumber, details, language)
    return { success: result.success, provider: 'slt', error: result.error, messageId: result.messageId }
  }

  /**
   * Send appointment reminder SMS
   */
  async sendAppointmentReminder(
    mobileNumber: string,
    details: {
      name: string
      outletName: string
      dateTime: string
      minutesRemaining: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SendSMSResult> {
    // Since SMS doesn't support Unicode properly, use English for all languages
    const messageText = `Dear Valued Customer\n\nReminder: Your appointment at ${details.outletName} is in ${details.minutesRemaining} minutes (${details.dateTime}).\n\nPlease arrive on time.\n\nSLT-MOBITEL`

    return this.sendSMS({
      to: mobileNumber,
      body: messageText,
      language: 'en'
    })
  }
}

// Export singleton instance
export default new UnifiedSmsHelper()
