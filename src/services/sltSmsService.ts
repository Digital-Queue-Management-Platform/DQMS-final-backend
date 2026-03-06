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
      si: `ගරු පාරිභෝගිකයා\n\n${appointmentDetails.outletName} හි ${appointmentDetails.dateTime} සඳහා ඔබගේ හමුව තහවුරු කර ඇත. කරුණාකර විනාඩි 10කට පෙර පැමිණෙන්න. ස්තුතියි.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${appointmentDetails.outletName} இல் ${appointmentDetails.dateTime} அன்று உங்கள் சந்திப்பு உறுதிப்படுத்தப்பட்டது. தயவுசெய்து 10 நிமிடங்களுக்கு முன்பாக வரவும். நன்றி.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send appointment reminder notification
   * @param hoursBeforeAppointment - Number of hours before the appointment (24 or 1)
   */
  async sendAppointmentReminder(
    mobileNumber: string,
    appointmentDetails: {
      outletName: string
      dateTime: string
      hoursBeforeAppointment: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const reminderType = appointmentDetails.hoursBeforeAppointment === 24 ? 'tomorrow' : 'today'
    
    const messages = {
      en: appointmentDetails.hoursBeforeAppointment === 24
        ? `Dear Valued Customer\n\nReminder: You have an appointment tomorrow at ${appointmentDetails.dateTime} at ${appointmentDetails.outletName}. We look forward to serving you.\n\nSLT-MOBITEL`
        : `Dear Valued Customer\n\nReminder: You have an appointment today at ${appointmentDetails.dateTime} at ${appointmentDetails.outletName}. We look forward to serving you.\n\nSLT-MOBITEL`,
      si: appointmentDetails.hoursBeforeAppointment === 24
        ? `ගරු පාරිභෝගිකයා\n\nසිහිකැඳවීම: ඔබට හෙට ${appointmentDetails.dateTime} ට ${appointmentDetails.outletName} හි හමුවක් ඇත. ඔබට සේවය කිරීමට අපි බලාපොරොත්තු වෙමු.\n\nSLT-MOBITEL`
        : `ගරු පාරිභෝගිකයා\n\nසිහිකැඳවීම: ඔබට අද ${appointmentDetails.dateTime} ට ${appointmentDetails.outletName} හි හමුවක් ඇත. ඔබට සේවය කිරීමට අපි බලාපොරොත්තු වෙමු.\n\nSLT-MOBITEL`,
      ta: appointmentDetails.hoursBeforeAppointment === 24
        ? `அன்பு வாடிக்கையாளரே\n\nநினைவூட்டல்: நாளை ${appointmentDetails.dateTime} அன்று ${appointmentDetails.outletName} இல் உங்களுக்கு சந்திப்பு உள்ளது. உங்களுக்கு சேவை செய்ய நாங்கள் எதிர்நோக்குகிறோம்.\n\nSLT-MOBITEL`
        : `அன்பு வாடிக்கையாளரே\n\nநினைவூட்டல்: இன்று ${appointmentDetails.dateTime} அன்று ${appointmentDetails.outletName} இல் உங்களுக்கு சந்திப்பு உள்ளது. உங்களுக்கு சேவை செய்ய நாங்கள் எதிர்நோக்குகிறோம்.\n\nSLT-MOBITEL`
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
    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    
    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} will expire soon. Kindly arrive within ${details.minutesRemaining} minutes.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} ඉක්මනින් කල් ඉකුත් වේ. කරුණාකර විනාඩි ${details.minutesRemaining} ඇතුළත පැමිණෙන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} விரைவில் காலாவதியாகும். தயவுசெய்து ${details.minutesRemaining} நிமிடங்களுக்குள் வரவும்.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: messages[language]
    })
  }

  /**
   * Send service delay notification
   */
  async sendServiceDelayNotification(
    mobileNumber: string,
    details: {
      tokenNumber: number
      outletName: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    
    const messages = {
      en: `Dear Valued Customer\n\nWe're experiencing a delay in service. Your token number ${formattedToken} will be called shortly. We appreciate your patience.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nසේවාවේ ප්‍රමාදයක් ඇත. ඔබගේ ටෝකන් අංකය ${formattedToken} ඉක්මනින් ඇමතීමට යොදවනු ඇත. ඔබගේ ඉවසීම අගය කරමු.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nசேவையில் தாமதம் ஏற்பட்டுள்ளது. உங்கள் டோக்கன் எண் ${formattedToken} விரைவில் அழைக்கப்படும். உங்கள் பொறுமைக்கு நன்றி.\n\nSLT-MOBITEL`
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
    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = tokenNumber.toString().padStart(3, '0')
    
    const messages = {
      en: `Dear Valued Customer\n\nToken Number ${formattedToken}. Please proceed to Counter ${counterNumber}.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nටෝකන් අංකය ${formattedToken}. කරුණාකර කවුන්ටර් ${counterNumber} වෙත යන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nடோக்கன் எண் ${formattedToken}. தயவுசெய்து கவுண்டர் ${counterNumber} க்கு செல்லவும்.\n\nSLT-MOBITEL`
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
    const message = `Dear Valued Customer\n\nYour SLT bill payment reminder:\n\nAmount: Rs. ${billDetails.amount}\nDue Date: ${billDetails.dueDate}\nAccount: ${billDetails.accountNumber}\n\nSLT-MOBITEL`

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

    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')

    const fullEnglishMessage = `Dear Valued Customer\n\nToken Number ${formattedToken}. Please proceed to Counter ${details.counterNumber}.\n\nStatus: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`
    const compactEnglishMessage = `Dear Valued Customer\n\nToken Number ${formattedToken}. Please proceed to Counter ${details.counterNumber}.\n\nSLT-MOBITEL`
    
    const messages = {
      en: fullEnglishMessage.length <= 160 ? fullEnglishMessage : compactEnglishMessage,
      si: `ගරු පාරිභෝගිකයා\n\nටෝකන් අංකය ${formattedToken}. කරුණාකර කවුන්ටර් ${details.counterNumber} වෙත යන්න.\n\nතත්වය: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nடோக்கன் எண் ${formattedToken}. தயவுசெய்து கவுண்டர் ${details.counterNumber} க்கு செல்லவும்.\n\nநிலை: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`
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

    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    
    const messages = {
      en: `Dear Valued Customer\n\nToken ${formattedToken} was skipped.\n\nStatus: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nටෝකන් ${formattedToken} මඟ හැරිණි.\n\nතත්වය: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nடோக்கன் ${formattedToken} தவிர்க்கப்பட்டது.\n\nநிலை: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`
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

    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    
    const messages = {
      en: `Dear Valued Customer\n\nToken ${formattedToken} has been recalled.\n\nStatus: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nටෝකන් ${formattedToken} නැවත ඇමතිණි.\n\nතත්වය: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nடோக்கன் ${formattedToken} திரும்ப அழைக்கப்பட்டது.\n\nநிலை: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`
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
      tokenNumber?: number
      refNumber: string
      services: string
      feedbackUrl: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS COMPLETE] Attempting to send service completion SMS to ${mobileNumber} for ref ${details.refNumber}`)

    // Format token number to 3 digits if provided
    const formattedToken = details.tokenNumber ? details.tokenNumber.toString().padStart(3, '0') : null
    
    const messages = {
      en: formattedToken 
        ? `Thank you! Service completed. Ref: ${details.refNumber}. Feedback: ${details.feedbackUrl} -SLT-MOBITEL`
        : `Thank you! Service completed. Ref: ${details.refNumber}. Feedback: ${details.feedbackUrl} -SLT-MOBITEL`,
      si: formattedToken
        ? `ස්තුතියි! සේවාව සම්පූර්ණයි. Ref: ${details.refNumber}. ප්‍රතිපෝෂණ: ${details.feedbackUrl} -SLT-MOBITEL`
        : `ස්තුතියි! සේවාව සම්පූර්ණයි. Ref: ${details.refNumber}. ප්‍රතිපෝෂණ: ${details.feedbackUrl} -SLT-MOBITEL`,
      ta: formattedToken
        ? `நன்றி! சேவை முடிந்தது. Ref: ${details.refNumber}. கருத்து: ${details.feedbackUrl} -SLT-MOBITEL`
        : `நன்றி! சேவை முடிந்தது. Ref: ${details.refNumber}. கருத்து: ${details.feedbackUrl} -SLT-MOBITEL`
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
    const messages = {
      en: `Dear Valued Customer\n\nYour registration code for ${details.outletName} is ${details.otpCode}. Valid for 5 minutes.\n\nContinue: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} සඳහා ඔබගේ ලියාපදිංචි කේතය ${details.otpCode}. මිනිත්තු 5 සඳහා වලංගුයි.\n\nදිගටම කරගෙන යන්න: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} க்கான உங்கள் பதிவு குறியீடு ${details.otpCode}. 5 நிமிடங்களுக்கு செல்லுபடியாகும்.\n\nதொடர: ${details.recoveryUrl} -SLT\n\nSLT-MOBITEL`
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
      firstName?: string
      tokenNumber: number
      queuePosition: number
      outletName: string
      trackingUrl?: string
      services?: string
      estimatedWait?: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    const estimatedWait = details.estimatedWait ?? Math.max(1, details.queuePosition * 5)
    const hasTrackingUrl = !!details.trackingUrl

    const fullEnglishMessage = hasTrackingUrl
      ? `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active. You are currently in position ${details.queuePosition} with an estimated wait time of ${estimatedWait} minutes.\n\nStatus: ${details.trackingUrl} -SLT\n\nSLT-MOBITEL`
      : `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active. You are currently in position ${details.queuePosition} with an estimated wait time of ${estimatedWait} minutes.\n\nSLT-MOBITEL`

    const buildCompactEnglishMessage = () => {
      const statusSuffix = hasTrackingUrl ? `\n\nStatus: ${details.trackingUrl} -SLT` : ''
      const prefix = `Dear Valued Customer\n\nToken ${formattedToken} at `
      const suffix = ` is active. Position ${details.queuePosition}. Est. wait ${estimatedWait} min.${statusSuffix}\n\nSLT-MOBITEL`
      const maxOutletLength = 160 - prefix.length - suffix.length
      const safeMax = Math.max(8, maxOutletLength)
      const outlet = details.outletName.length > safeMax
        ? `${details.outletName.slice(0, safeMax - 3).trimEnd()}...`
        : details.outletName

      const compact = `${prefix}${outlet}${suffix}`
      if (compact.length <= 160) return compact

      if (hasTrackingUrl) {
        const compactWithStatus = `Dear Valued Customer\n\nToken ${formattedToken} active. Pos ${details.queuePosition}. Wait ${estimatedWait} min.\n\nStatus: ${details.trackingUrl} -SLT\n\nSLT-MOBITEL`
        if (compactWithStatus.length <= 160) return compactWithStatus
      }

      return `Dear Valued Customer\n\nToken ${formattedToken} active. Pos ${details.queuePosition}. Wait ${estimatedWait} min.\n\nSLT-MOBITEL`
    }
    
    const messages = {
      en: fullEnglishMessage.length <= 160 ? fullEnglishMessage : buildCompactEnglishMessage(),
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} දැන් සක්‍රීයයි. ඔබ දැනට ${details.queuePosition} ස්ථානයේ සිටී. ඇස්තමේන්තු පොරොත්තු කාලය: විනාඩි ${estimatedWait}.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} இப்போது செயலில் உள்ளது. நீங்கள் தற்போது ${details.queuePosition} நிலையில் உள்ளீர்கள். மதிப்பீட்டு காத்திருப்பு நேரம்: ${estimatedWait} நிமிடங்கள்.\n\nSLT-MOBITEL`
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
    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    
    const messages = {
      en: `Dear Valued Customer\n\nWelcome to ${details.outletName}!\n\nYour token number: ${formattedToken}\nEstimated wait time: ${details.estimatedWait} minutes\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} වෙත සාදරයෙන් පිළිගනිමු!\n\nඔබගේ ටෝකන් අංකය: ${formattedToken}\nඇස්තමේන්තු පොරොත්තු කාලය: විනාඩි ${details.estimatedWait}\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} க்கு வரவேற்கிறோம்!\n\nஉங்கள் டோக்கன் எண்: ${formattedToken}\nமதிப்பீட்டு காத்திருப்பு நேரம்: ${details.estimatedWait} நிமிடங்கள்\n\nSLT-MOBITEL`
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
