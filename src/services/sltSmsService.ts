import axios, { AxiosInstance } from 'axios'
import https from 'https'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

interface SLTConfig {
  username: string
  password: string
  smsAlias: string
  apiUrl: string
}

interface SendSMSParams {
  to: string
  message: string
}

interface SMSResponse {
  success: boolean
  messageId?: string
  error?: string
}

class SLTSmsService {
  private config: SLTConfig
  private axiosInstance: AxiosInstance

  constructor() {
    this.config = {
      username: process.env.SLT_SMS_USERNAME || '',
      password: process.env.SLT_SMS_PASSWORD || '',
      smsAlias: process.env.SLT_SMS_ALIAS || '',
      apiUrl: process.env.SLT_SMS_API_URL || 'https://smsc.slt.lk:8093/api/sms'
    }

    this.axiosInstance = axios.create({
      baseURL: this.config.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      // Disable SSL certificate verification for SLT SMS Gateway
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    })
  }

  /**
   * Normalize mobile number to Sri Lankan format
   * Supports: 0771234567, 771234567, +94771234567
   * Returns: 94771234567 (international format without +)
   */
  private normalizeMobileNumber(mobile: string): string {
    // Remove all non-digit characters
    let digits = mobile.replace(/\D/g, '')

    // If starts with 94, it's already in international format
    if (digits.startsWith('94')) {
      return digits
    }

    // If starts with 0, remove it and add 94
    if (digits.startsWith('0')) {
      return '94' + digits.substring(1)
    }

    // If it's just the number without prefix, add 94
    if (digits.length === 9) {
      return '94' + digits
    }

    return digits
  }

  /**
   * Send SMS using SLT SMS Gateway
   * Based on SLT SMSC REST API
   */
  async sendSMS(params: SendSMSParams): Promise<SMSResponse> {
    try {
      // Validate credentials
      if (!this.config.username || !this.config.password || !this.config.smsAlias) {
        console.warn('SLT SMS credentials not configured')
        return {
          success: false,
          error: 'SLT SMS service not configured'
        }
      }

      // Normalize mobile number
      const normalizedMobile = this.normalizeMobileNumber(params.to)

      // Validate Sri Lankan mobile number (should start with 94 and be 11 digits)
      if (!normalizedMobile.startsWith('94') || normalizedMobile.length !== 11) {
        console.error(`Invalid Sri Lankan mobile number: ${params.to}`)
        return {
          success: false,
          error: 'Invalid mobile number format'
        }
      }

      console.log(`[SLT SMS] Sending SMS to ${normalizedMobile}`)

      // Send request to SLT SMS API using GET with query parameters
      const response = await this.axiosInstance.get('', {
        params: {
          src: this.config.smsAlias,
          dst: normalizedMobile,
          msg: params.message,
          user: this.config.username,
          password: this.config.password,
          dr: 1,  // Delivery report
          type: 0  // Message type
        }
      })

      // Check response - SLT API typically returns status in response
      if (response.status === 200) {
        console.log(`[SLT SMS] Message sent successfully to ${normalizedMobile}`)
        return {
          success: true,
          messageId: response.data?.messageId || Date.now().toString()
        }
      } else {
        console.error(`[SLT SMS] Failed to send message:`, response.data)
        return {
          success: false,
          error: response.data?.error || 'Failed to send SMS'
        }
      }
    } catch (error: any) {
      console.error('[SLT SMS] Error sending SMS:', error.message)
      return {
        success: false,
        error: error.message || 'Failed to send SMS'
      }
    }
  }

  /**
   * Send OTP SMS
   */
  async sendOTP(
    mobileNumber: string,
    otpCode: string,
    userType?: string,
    userName?: string,
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    // Map user types to readable role names
    const roleNames: Record<string, { en: string; si: string; ta: string }> = {
      officer: { en: 'Officer', si: 'නිලධාරී', ta: 'அதிகாரி' },
      teleshop_manager: { en: 'Teleshop Manager', si: 'ටෙලිෂොප් කළමනාකරු', ta: 'டெலிஷாப் மேலாளர்' },
      rtom: { en: 'Regional Manager', si: 'කලාප කළමනාකරු', ta: 'பிராந்திய மேலாளர்' },
      gm: { en: 'General Manager', si: 'සාමාන්‍ය කළමනාකරු', ta: 'பொது மேலாளர்' },
      dgm: { en: 'Deputy General Manager', si: 'නියෝජ්‍ය සාමාන්‍ය කළමනාකරු', ta: 'துணை பொது மேலாளர்' }
    }

    const role = userType && roleNames[userType] ? roleNames[userType] : null

    // Extract first name only for personalization
    const firstName = userName ? userName.split(' ')[0] : null
    const greeting = firstName ? `Dear ${firstName},` : ''

    // Keep messages concise and professional
    const otpMessages = {
      en: role
        ? `SLT DQMS: ${greeting} Your ${role.en} login code is ${otpCode}. Valid for 5 minutes. Do not share this code. -SLT Mobitel`
        : `SLT DQMS: ${greeting} Your login code is ${otpCode}. Valid for 5 minutes. Do not share this code. -SLT Mobitel`,
      si: role
        ? `SLT DQMS: ${firstName ? `${firstName},` : ''} ඔබගේ ${role.si} කේතය ${otpCode}. මිනිත්තු 5. කේතය බෙදා නොගන්න. -SLT Mobitel`
        : `SLT DQMS: ${firstName ? `${firstName},` : ''} ඔබගේ කේතය ${otpCode}. මිනිත්තු 5. -SLT Mobitel`,
      ta: role
        ? `SLT DQMS: ${firstName ? `${firstName},` : ''} உங்கள் ${role.ta} குறியீடு ${otpCode}. 5 நிமிடம். பகிர வேண்டாம். -SLT Mobitel`
        : `SLT DQMS: ${firstName ? `${firstName},` : ''} உங்கள் குறியீடு ${otpCode}. 5 நிமிடம். -SLT Mobitel`
    }

    console.log(`[SLT SMS DEBUG] Sending OTP to ${mobileNumber}, userName: "${userName}", firstName: "${firstName}", userType: "${userType}", message: "${otpMessages[language]}" (${otpMessages[language].length} chars)`)

    return this.sendSMS({
      to: mobileNumber,
      message: otpMessages[language]
    })
  }

  /**
   * Send appointment confirmation SMS
   */
  async sendAppointmentConfirmation(
    mobileNumber: string,
    appointmentDetails: {
      name: string
      outletName: string
      dateTime: string
      services: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `Dear ${appointmentDetails.name}, your appointment at ${appointmentDetails.outletName} is confirmed for ${appointmentDetails.dateTime}. Services: ${appointmentDetails.services}. -DQMS`,
      si: `${appointmentDetails.name}, ${appointmentDetails.outletName} හි ඔබගේ හමුව ${appointmentDetails.dateTime} සඳහා තහවුරු කර ඇත. සේවාවන්: ${appointmentDetails.services}. -DQMS`,
      ta: `${appointmentDetails.name}, ${appointmentDetails.outletName} இல் உங்கள் சந்திப்பு ${appointmentDetails.dateTime} அன்று உறுதிப்படுத்தப்பட்டது. சேவைகள்: ${appointmentDetails.services}. -DQMS`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send token ready notification
   */
  async sendTokenReady(
    mobileNumber: string,
    tokenNumber: number,
    counterNumber: number,
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `Token #${tokenNumber}: Please proceed to Counter ${counterNumber}. -DQMS`,
      si: `ටෝකන් #${tokenNumber}: කරුණාකර කවුන්ටර් ${counterNumber} වෙත යන්න. -DQMS`,
      ta: `டோக்கன் #${tokenNumber}: கவுண்டர் ${counterNumber} க்கு செல்லவும். -DQMS`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send bill payment notification
   */
  async sendBillNotification(
    mobileNumber: string,
    billDetails: {
      accountName: string
      amount: string
      dueDate: string
      accountNumber: string
    }
  ): Promise<SMSResponse> {
    const message = `Dear ${billDetails.accountName}, your SLT bill: Rs. ${billDetails.amount} due on ${billDetails.dueDate}. Account: ${billDetails.accountNumber}. -SLT Telecom`

    return this.sendSMS({
      to: mobileNumber,
      message: message
    })
  }

  /**
   * Send customer called to counter notification
   */
  async sendCustomerCalled(
    mobileNumber: string,
    details: {
      firstName: string
      tokenNumber: number
      counterNumber: number
      outletName: string
      recoveryUrl: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS CALL] Attempting to send customer called SMS to ${mobileNumber} for token #${details.tokenNumber}`)

    const messages = {
      en: `SLT DQMS: Dear ${details.firstName}, Token #${details.tokenNumber} proceed to Counter ${details.counterNumber} at ${details.outletName}. Status: ${details.recoveryUrl} -SLT`,
      si: `SLT DQMS: ${details.firstName}, ටෝකන් #${details.tokenNumber} කරුණාකර ${details.outletName} කවුන්ටර් ${details.counterNumber} වෙත යන්න. තත්වය: ${details.recoveryUrl} -SLT`,
      ta: `SLT DQMS: ${details.firstName}, டோக்கன் #${details.tokenNumber} தயவுसெய்து ${details.outletName} கవுண்டர் ${details.counterNumber} க்கு செல்லவும். நிலை: ${details.recoveryUrl} -SLT`
    }

    console.log(`[SLT SMS CALL] Message content (${messages[language].length} chars): ${messages[language]}`)

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send customer skipped notification
   */
  async sendCustomerSkipped(
    mobileNumber: string,
    details: {
      firstName: string
      tokenNumber: number
      outletName: string
      recoveryUrl: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS SKIP] Attempting to send skip SMS to ${mobileNumber} for token #${details.tokenNumber}`)

    const messages = {
      en: `SLT DQMS: Dear ${details.firstName}, Token #${details.tokenNumber} skipped at ${details.outletName}. Check status: ${details.recoveryUrl} -SLT`,
      si: `SLT DQMS: ${details.firstName}, ටෝකන් #${details.tokenNumber} ${details.outletName} මඟ හැරිණි. තත්වය: ${details.recoveryUrl} -SLT`,
      ta: `SLT DQMS: ${details.firstName}, டோக்கன் #${details.tokenNumber} ${details.outletName} தவிர்க்கப்பட்டது. நிலை: ${details.recoveryUrl} -SLT`
    }

    console.log(`[SLT SMS SKIP] Message content (${messages[language].length} chars): "${messages[language]}"`)

    if (messages[language].length > 160) {
      console.warn(`[SLT SMS SKIP] WARNING: Message exceeds 160 chars (${messages[language].length}), might be split or rejected`)
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send customer recalled notification
   */
  async sendCustomerRecalled(
    mobileNumber: string,
    details: {
      firstName: string
      tokenNumber: number
      outletName: string
      recoveryUrl: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS RECALL] Attempting to send recall SMS to ${mobileNumber} for token #${details.tokenNumber}`)

    const messages = {
      en: `SLT DQMS: Dear ${details.firstName}, Token #${details.tokenNumber} recalled at ${details.outletName}. Check status: ${details.recoveryUrl} -SLT`,
      si: `SLT DQMS: ${details.firstName}, ටෝකන් #${details.tokenNumber} ${details.outletName} නැවත ඇමතිණි. තත්වය: ${details.recoveryUrl} -SLT`,
      ta: `SLT DQMS: ${details.firstName}, டோக்கன் #${details.tokenNumber} ${details.outletName} திரும்ப அழைக்கப்பட்டது. நிலை: ${details.recoveryUrl} -SLT`
    }

    console.log(`[SLT SMS RECALL] Message content (${messages[language].length} chars): "${messages[language]}"`)

    if (messages[language].length > 160) {
      console.warn(`[SLT SMS RECALL] WARNING: Message exceeds 160 chars (${messages[language].length}), might be split or rejected`)
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send service completion notification with feedback reminder
   */
  async sendServiceCompletion(
    mobileNumber: string,
    details: {
      firstName: string
      refNumber: string
      services: string
      feedbackUrl: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS COMPLETE] Attempting to send service completion SMS to ${mobileNumber} for ref ${details.refNumber}`)

    const messages = {
      en: `SLT DQMS: Dear ${details.firstName}, service completed. Ref: ${details.refNumber}. Please rate us: ${details.feedbackUrl} -SLT`,
      si: `SLT DQMS: ${details.firstName}, සේවාව සම්පූර්ණයි. Ref: ${details.refNumber}. කරුණාකර අගයන්න: ${details.feedbackUrl} -SLT`,
      ta: `SLT DQMS: ${details.firstName}, சேவை முடிந்தது. Ref: ${details.refNumber}. தயவुसेटि மதிப्पीटுங্গள्: ${details.feedbackUrl} -SLT`
    }

    console.log(`[SLT SMS COMPLETE] Message content (${messages[language].length} chars): "${messages[language]}"`)

    if (messages[language].length > 160) {
      console.warn(`[SLT SMS COMPLETE] WARNING: Message exceeds 160 chars (${messages[language].length}), might be split or rejected`)
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send OTP for customer registration with recovery URL
   */
  async sendCustomerRegistrationOTP(
    mobileNumber: string,
    details: {
      firstName?: string
      otpCode: string
      outletName: string
      recoveryUrl: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const greeting = details.firstName ? ` Dear ${details.firstName},` : ''

    const messages = {
      en: `SLT DQMS:${greeting} Your registration code for ${details.outletName} is ${details.otpCode}. Valid 5 min. Continue: ${details.recoveryUrl} -SLT`,
      si: `SLT DQMS:${details.firstName ? ` ${details.firstName},` : ''} ${details.outletName} ලියාපදිංචි කේතය ${details.otpCode}. මිනිත්තු 5. පුරිදු: ${details.recoveryUrl} -SLT`,
      ta: `SLT DQMS:${details.firstName ? ` ${details.firstName},` : ''} ${details.outletName} பதிவு குறியீடு ${details.otpCode}. 5 நிமிடம். தொடர்: ${details.recoveryUrl} -SLT`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send token number and queue position with tracking URL
   */
  async sendTokenConfirmation(
    mobileNumber: string,
    details: {
      firstName: string
      tokenNumber: number
      queuePosition: number
      outletName: string
      trackingUrl: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `SLT DQMS: Dear ${details.firstName}, Token #${details.tokenNumber} at ${details.outletName}. Position: ${details.queuePosition}. Track: ${details.trackingUrl} -SLT`,
      si: `SLT DQMS: ${details.firstName}, ${details.outletName} ටෝකන් #${details.tokenNumber}. ස්ථානය: ${details.queuePosition}. ට්‍රැක්: ${details.trackingUrl} -SLT`,
      ta: `SLT DQMS: ${details.firstName}, ${details.outletName} டෝக்கன் #${details.tokenNumber}. நிலை: ${details.queuePosition}. கண்காணி: ${details.trackingUrl} -SLT`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
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
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `Welcome ${details.name}! Your token #${details.tokenNumber} at ${details.outletName}. Est. wait: ${details.estimatedWait} min. -DQMS`,
      si: `සාදරයෙන් පිළිගනිමු ${details.name}! ඔබගේ ටෝකන් #${details.tokenNumber} - ${details.outletName}. ඇස්තමේන්තු් පොරොත්තුව: ${details.estimatedWait} මිනි. -DQMS`,
      ta: `வரவேற்கிறோம் ${details.name}! உங்கள் டோக்கன் #${details.tokenNumber} - ${details.outletName}. மதிப்பீட்டு காத்திருப்பு: ${details.estimatedWait} நிமி. -DQMS`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Check service availability
   */
  isConfigured(): boolean {
    return !!(this.config.username && this.config.password && this.config.smsAlias)
  }
}

// Export singleton instance
export default new SLTSmsService()
