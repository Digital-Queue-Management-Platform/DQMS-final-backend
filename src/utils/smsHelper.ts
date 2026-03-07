import Twilio from 'twilio'
import sltSmsService from '../services/sltSmsService'

export type SMSProvider = 'twilio' | 'slt' | 'both'

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
 * Unified SMS helper that supports multiple SMS providers
 * Can use Twilio, SLT SMS, or both (with fallback)
 */
class UnifiedSmsHelper {
  /**
   * Get the configured SMS provider from environment
   */
  getProvider(): SMSProvider {
    const provider = (process.env.SMS_PROVIDER || 'twilio').toLowerCase()
    if (provider === 'slt' || provider === 'both') {
      return provider as SMSProvider
    }
    return 'twilio'
  }

  /**
   * Check if Twilio is configured
   */
  isTwilioConfigured(): boolean {
    const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ""
    const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ""
    const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || ""
    const MSG_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || ""

    return !!(ACCOUNT_SID && AUTH_TOKEN && (MSG_SERVICE_SID || FROM_NUMBER))
  }

  /**
   * Check if SLT SMS is configured
   */
  isSltConfigured(): boolean {
    return sltSmsService.isConfigured()
  }

  /**
   * Send SMS using configured provider(s)
   */
  async sendSMS(options: SendSMSOptions): Promise<SendSMSResult> {
    const { to, body, language = 'en' } = options
    const provider = this.getProvider()

    // Development mode check
    const OTP_DEV_MODE = process.env.OTP_DEV_MODE === "true"
    if (OTP_DEV_MODE) {
      console.log(`[SMS][DEV] Message to ${to}: ${body}`)
      return { success: true, provider: 'dev' }
    }

    // Try SLT SMS first if configured
    if (provider === 'slt' || provider === 'both') {
      if (this.isSltConfigured()) {
        try {
          const result = await sltSmsService.sendSMS({ to, message: body })
          if (result.success) {
            console.log(`[SMS] Sent via SLT SMS to ${to}`)
            return { success: true, provider: 'slt', messageId: result.messageId }
          } else {
            console.warn(`[SMS] SLT SMS failed: ${result.error}`)
            // If 'slt' only, return the error
            if (provider === 'slt') {
              return { success: false, provider: 'slt', error: result.error }
            }
            // If 'both', continue to try Twilio as fallback
          }
        } catch (error: any) {
          console.error('[SMS] SLT SMS error:', error.message)
          if (provider === 'slt') {
            return { success: false, provider: 'slt', error: error.message }
          }
          // Continue to Twilio fallback for 'both'
        }
      }
    }

    // Try Twilio as primary or fallback
    if (provider === 'twilio' || provider === 'both') {
      if (this.isTwilioConfigured()) {
        try {
          const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
          const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
          const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || ""
          const MSG_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || ""

          const twilioClient = Twilio(ACCOUNT_SID, AUTH_TOKEN)

          // Normalize phone number to E.164 format
          let normalizedTo = to
          if (!to.startsWith('+')) {
            if (to.startsWith('94')) {
              normalizedTo = '+' + to
            } else if (to.startsWith('0')) {
              normalizedTo = '+94' + to.substring(1)
            } else if (to.length === 9) {
              normalizedTo = '+94' + to
            }
          }

          const params: any = { to: normalizedTo, body }
          if (MSG_SERVICE_SID) {
            params.messagingServiceSid = MSG_SERVICE_SID
          } else if (FROM_NUMBER) {
            params.from = FROM_NUMBER
          }

          const message = await twilioClient.messages.create(params)
          console.log(`[SMS] Sent via Twilio to ${normalizedTo}`)
          return { success: true, provider: 'twilio', messageId: message.sid }
        } catch (error: any) {
          console.error('[SMS] Twilio error:', error.message)
          return { success: false, provider: 'twilio', error: error.message }
        }
      }
    }

    // No provider configured
    return {
      success: false,
      error: 'No SMS provider configured. Please configure SLT_SMS or TWILIO credentials.'
    }
  }

  /**
   * Send OTP SMS
   */
  async sendOTP(mobileNumber: string, otpCode: string, language: 'en' | 'si' | 'ta' = 'en'): Promise<SendSMSResult> {
    const otpMessages = {
      en: `Dear Valued Customer\n\nYour verification code is ${otpCode}. Valid for 5 minutes.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nඔබගේ සත්‍යාපන කේතය ${otpCode}. මිනිත්තු 5ක් සඳහා වලංගුයි.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nஉங்கள் சரிபார்ப்பு குறியீடு ${otpCode}. 5 நிமிடங்களுக்கு செல்லுபடியாகும்.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      body: otpMessages[language],
      language
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
    const messages = {
      en: `Dear Valued Customer\n\nYour appointment at ${details.outletName} is confirmed for ${details.dateTime}.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ හමුව ${details.dateTime} සඳහා තහවුරු කර ඇත.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் சந்திப்பு ${details.dateTime} அன்று உறுதிப்படுத்தப்பட்டது.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      body: messages[language],
      language
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
    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} is now being called. Please proceed to Counter ${counterNumber}.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nඔබගේ ටෝකන් අංකය ${formattedToken} සඳහා දැන් කැඳවනු ලැබේ. කරුණාකර කවුන්ටර් ${counterNumber} වෙත පැමිණෙන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nஉங்கள் டோக்கன் எண் ${formattedToken} தற்போது அழைக்கப்படுகிறது. தயவுசெய்து கவுண்டர் ${counterNumber} க்கு செல்லவும்.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      body: messages[language],
      language
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
    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active. You are currently in position ${details.position || 1}.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} ශාඛාවේ ඔබගේ ටෝකන් අංකය ${formattedToken} දැන් සක්‍රීයයි. ඔබ දැන් පෝලිමේ ${details.position || 1} වන ස්ථානයේ සිටී.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} இப்போது செயலில் உள்ளது. நீங்கள் தற்போது வரிசையில் ${details.position || 1} வது இடத்தில் உள்ளீர்கள்.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      body: messages[language],
      language
    })
  }
}

// Export singleton instance
export default new UnifiedSmsHelper()
