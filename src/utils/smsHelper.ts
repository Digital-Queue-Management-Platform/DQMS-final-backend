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
    const messages = {
      en: `Dear Valued Customer\n\nYour SLT account ${details.accountNumber} has an outstanding balance of Rs. ${details.amount}. Please settle the bill by ${details.dueDate} to avoid service interruption.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nඔබගේ SLT ගිණුම ${details.accountNumber} හි හිඟ ශේෂය රු. ${details.amount} කි. සේවා බාධාවන් වළක්වා ගැනීමට කරුණාකර ${details.dueDate} දිනට පෙර බිල්පත ගෙවන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nஉங்கள் SLT கணக்கு ${details.accountNumber} இல் ரூ. ${details.amount} நிலுவைத் தொகை உள்ளது. சேவைத் தடையைத் தவிர்க்க தயவுசெய்து ${details.dueDate} க்குள் கட்டணத்தைச் செலுத்தவும்.\n\nSLT-MOBITEL`
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
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active (Queue Position: ${details.position || 1}).\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} ශාඛාවේ ඔබගේ ටෝකන් අංකය ${formattedToken} දැන් සක්‍රීයයි (පෝලිමේ ස්ථානය: ${details.position || 1}).\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} இப்போது செயலில் உள்ளது (வரிசை நிலை: ${details.position || 1}).\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      body: messages[language],
      language
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
}

// Export singleton instance
export default new UnifiedSmsHelper()
