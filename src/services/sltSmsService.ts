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
        ? `SLT DQMS: ${greeting} Your ${role.en} login code is ${otpCode}. Valid for 5 minutes. Do not share this code. -SLT-MOBITEL`
        : `SLT DQMS: ${greeting} Your login code is ${otpCode}. Valid for 5 minutes. Do not share this code. -SLT-MOBITEL`,
      si: role
        ? `SLT DQMS: ${firstName ? `${firstName},` : ''} ඔබගේ ${role.si} කේතය ${otpCode}. මිනිත්තු 5. කේතය බෙදා නොගන්න. -SLT-MOBITEL`
        : `SLT DQMS: ${firstName ? `${firstName},` : ''} ඔබගේ කේතය ${otpCode}. මිනිත්තු 5. -SLT-MOBITEL`,
      ta: role
        ? `SLT DQMS: ${firstName ? `${firstName},` : ''} உங்கள் ${role.ta} குறியீடு ${otpCode}. 5 நிமிடம். பகிர வேண்டாம். -SLT-MOBITEL`
        : `SLT DQMS: ${firstName ? `${firstName},` : ''} உங்கள் குறியீடு ${otpCode}. 5 நிமிடம். -SLT-MOBITEL`
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
      en: `Dear Valued Customer\n\nYour appointment is confirmed for ${appointmentDetails.dateTime} at ${appointmentDetails.outletName}. Please arrive 10 minutes early. Thank You.\n\nSLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු\n\nඔබගේ හමුව ${appointmentDetails.dateTime} සඳහා ${appointmentDetails.outletName} හි තහවුරු කර ඇත. කරුණාකර මිනිත්තු 10ක් කලින් පැමිණෙන්න.\n\nSLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர்\n\nஉங்கள் சந்திப்பு ${appointmentDetails.dateTime} அன்று ${appointmentDetails.outletName} இல் உறுதிப்படுத்தப்பட்டது. தயவுசெய்து 10 நிமிடம் முன்பே வரவும்.\n\nSLT-MOBITEL`
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
    language: 'en' | 'si' | 'ta' = 'en',
    trackingUrl?: string
  ): Promise<SMSResponse> {
    const trackingInfo = trackingUrl ? `\n\nStatus: ${trackingUrl}` : '';
    const messages = {
      en: `Dear Valued Customer\n\nToken Number ${tokenNumber}. Please proceed to Counter ${counterNumber}.${trackingInfo}\n\nSLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු\n\nටෝකන් සංඛ්‍යා ${tokenNumber}. කරුණාකර කවුන්ටර් ${counterNumber} වෙත යන්න.${trackingInfo}\n\nSLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர்\n\nடோக்கன் எண் ${tokenNumber}. கவுண்டர் ${counterNumber} க்கு செல்லவும்.${trackingInfo}\n\nSLT-MOBITEL`
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
    const message = `Dear ${billDetails.accountName}, your SLT bill: Rs. ${billDetails.amount} due on ${billDetails.dueDate}. Account: ${billDetails.accountNumber}. -SLT-MOBITEL`

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
      en: `Dear Valued Customer\n\nToken Number ${details.tokenNumber}. Please proceed to Counter ${details.counterNumber}.\n\nStatus: ${details.recoveryUrl}\n\nSLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු\n\nටෝකන් සංඛ්‍යා ${details.tokenNumber}. කරුණාකර කවුන්ටර් ${details.counterNumber} වෙත යන්න.\n\nතත්වය: ${details.recoveryUrl}\n\nSLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர்\n\nடோக்கன் எண் ${details.tokenNumber}. கவுண்டர் ${details.counterNumber} க்கு செல்லவும்.\n\nநிலை: ${details.recoveryUrl}\n\nSLT-MOBITEL`
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
      en: `Dear Valued Customer\n\nToken Number ${details.tokenNumber} could not be processed at ${details.outletName}.\n\nCheck status: ${details.recoveryUrl}\n\nSLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු\n\nටෝකන් සංඛ්‍යා ${details.tokenNumber} ${details.outletName} බිම සැකසිය නොහැකි විය.\n\nතත්වය: ${details.recoveryUrl}\n\nSLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர்\n\nடோக்கன் எண் ${details.tokenNumber} ஐ ${details.outletName} இல் செயல்படுத்த முடியவில்லை.\n\nநிலை: ${details.recoveryUrl}\n\nSLT-MOBITEL`
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
      en: `Dear Valued Customer\n\nToken Number ${details.tokenNumber}.\n\nPlease proceed to Counter at ${details.outletName}.\n\nCheck status: ${details.recoveryUrl}\n\nSLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු\n\nටෝකන් සංඛ්‍යා ${details.tokenNumber}.\n\n${details.outletName} බිම කවුන්ටරට යන්න.\n\nතත්වය: ${details.recoveryUrl}\n\nSLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர்\n\nடோக்கன் எண் ${details.tokenNumber}.\n\n${details.outletName} கவுண்டருக்கு செல்லவும்.\n\nநிலை: ${details.recoveryUrl}\n\nSLT-MOBITEL`
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
      tokenNumber?: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS COMPLETE] Attempting to send service completion SMS to ${mobileNumber} for ref ${details.refNumber}`)

    const messages = {
      en: `Dear Valued Customer\n\nYour service has been successfully completed. Thank you for visiting us.\n\nRef: ${details.refNumber}\nFeedback: ${details.feedbackUrl}\n\nSLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු\n\nඔබගේ සේවාව සාර්ථකව සම්පූර්ණ කර ඇත. අපට පැමිණීම සඳහා ස්තුතියි.\n\nRef: ${details.refNumber}\nප්‍රතිචාරය: ${details.feedbackUrl}\n\nSLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர்\n\nஉங்கள் சேவை வெற்றிகரமாக முடிந்துவிட்டது. எங்களை பார்வையிட்டமைக்கு நன்றி.\n\nRef: ${details.refNumber}\nபின்னூட்டம்: ${details.feedbackUrl}\n\nSLT-MOBITEL`
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
      en: `Your registration code for ${details.outletName} is ${details.otpCode}. Valid for 5 minutes. Continue: ${details.recoveryUrl} -SLT-MOBITEL`,
      si: `${details.outletName} සඳහා ඔබගේ ලියාපදිංචි කේතය ${details.otpCode}. මිනිත්තු 5ට වලංගු. පුරිදු: ${details.recoveryUrl} -SLT-MOBITEL`,
      ta: `${details.outletName} க்கான உங்கள் பதிவு குறியீடு ${details.otpCode}. 5 நிமிடங்களுக்கு செல்லுபடியாகும். தொடர்: ${details.recoveryUrl} -SLT-MOBITEL`
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
      services: string
      estimatedWaitMinutes?: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const waitTimeInfo = details.estimatedWaitMinutes 
      ? ` with an estimated wait time of ${details.estimatedWaitMinutes} minutes` 
      : '';
    const waitTimeInfoSi = details.estimatedWaitMinutes 
      ? ` ඇස්තමේන්තු පොරොත්තු කාලය මිනිත්තු ${details.estimatedWaitMinutes}` 
      : '';
    const waitTimeInfoTa = details.estimatedWaitMinutes 
      ? ` மதிப்பீட்டு காத்திருப்பு நேரம் ${details.estimatedWaitMinutes} நிமிடங்கள்` 
      : '';

    const messages = {
      en: `Dear Valued Customer Your token number ${details.tokenNumber} at ${details.outletName} is now active. You are currently in position ${details.queuePosition}${waitTimeInfo}. SLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු ඔබගේ ටෝකන් සංඛ්‍යා ${details.tokenNumber} - ${details.outletName} දැන් ක්‍රියාකාරී ය. ඔබ දැනට ස්ථානයේ ${details.queuePosition}${waitTimeInfoSi}. SLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர் உங்கள் டோக்கன் எண் ${details.tokenNumber} - ${details.outletName} இப்போது செயல்பாட்டுத் தமாய உள்ளது. நீங்கள் தற்போது நிலை ${details.queuePosition}${waitTimeInfoTa}. SLT-MOBITEL`
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
      en: `Dear Valued Customer Your token number ${details.tokenNumber} at ${details.outletName} is now active. SLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු ඔබගේ ටෝකන් සංඛ්‍යා ${details.tokenNumber} - ${details.outletName} දැන් ක්‍රියාකාරී ය. SLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர் உங்கள் டோக்கன் எண் ${details.tokenNumber} - ${details.outletName} இப்போது செயல்பாட்டுத் தமாய உள்ளது. SLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send appointment reminder
   */
  async sendAppointmentReminder(
    mobileNumber: string,
    details: {
      time: string
      outletName: string
      date: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `Dear Valued Customer Reminder: You have an appointment tomorrow at ${details.time} at ${details.outletName}. We look forward to serving you. SLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු මතක් කිරීම: ඔබට හෙට ${details.time} ට ${details.outletName} හි හමුවක් ඇත. අපි ඔබට සේවය කිරීමට බලාපොරොත්තු වෙමු. SLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர் நினைவூட்டல்: நாளை ${details.time} க்கு ${details.outletName} இல் உங்களுக்கு சந்திப்பு உள்ளது. உங்களுக்கு சேவை செய்ய நாங்கள் ஆவலுடன் காத்திருக்கிறோம். SLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send token expiry warning
   */
  async sendTokenExpiryWarning(
    mobileNumber: string,
    details: {
      tokenNumber: number
      outletName: string
      minutesRemaining: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `Dear Valued Customer Your token number ${details.tokenNumber} at ${details.outletName} will expire soon. Kindly arrive within ${details.minutesRemaining} minutes. SLT-MOBITEL`,
      si: `ගරු ගිණුම්කරු ${details.outletName} හි ඔබගේ ටෝකන් සංඛ්‍යා ${details.tokenNumber} ඉක්මනින් කල් ඉකුත් වනු ඇත. කරුණාකර මිනිත්තු ${details.minutesRemaining} ඇතුළත පැමිණෙන්න. SLT-MOBITEL`,
      ta: `மதிப்புமிக்க வாடிக்கையாளர் ${details.outletName} இல் உங்கள் டோக்கன் எண் ${details.tokenNumber} விரைவில் காலாவதியாகும். தயவுசெய்து ${details.minutesRemaining} நிமிடங்களுக்குள் வரவும். SLT-MOBITEL`
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
