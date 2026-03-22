import axios, { AxiosInstance } from 'axios'
import https from 'https'
import dotenv from 'dotenv'
import { logger } from '../server'

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
    const original = mobile
    // Remove all non-digit characters
    let digits = mobile.replace(/\D/g, '')

    // If starts with 94, it's already in international format
    if (digits.startsWith('94')) {
      return digits
    }

    // If starts with 0, remove it and add 94
    if (digits.startsWith('0')) {
      digits = '94' + digits.substring(1)
    } else if (digits.length === 9) {
      // If it's just the number without prefix, add 94
      digits = '94' + digits
    }

    console.log(`[SLT SMS] Normalizing ${original} -> ${digits}`)
    return digits
  }

  /**
   * Convert string to UTF-16BE hex format for Unicode SMS
   * SMS gateways (like SLT) require this for messages with type=2 (Unicode/DCS=8)
   */
  private toHexUnicode(str: string): string {
    let hex = ""
    for (let i = 0; i < str.length; i++) {
      // Get the 16-bit code unit, convert to hex, pad to 4 digits, uppercase
      hex += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
    }
    return hex
  }

  /**
   * Send SMS using SLT SMS Gateway
   * Based on SLT SMSC REST API
   */
  async sendSMS(params: SendSMSParams): Promise<SMSResponse> {
    try {
      // Validate credentials
      if (!this.config.username || !this.config.password || !this.config.smsAlias) {
        logger.warn('SLT SMS credentials not configured')
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

      // Detect if message contains Unicode characters (non-ASCII)
      const isUnicode = /[^\x00-\x7F]/.test(params.message)
      const messageType = isUnicode ? 2 : 0

      // For Unicode messages, some gateways (like SLT) require HEX encoding of UTF-16BE
      const processedMessage = isUnicode
        ? this.toHexUnicode(params.message)
        : params.message

      logger.info({ to: normalizedMobile, isUnicode, type: messageType }, '[SLT SMS] Sending SMS')
      if (process.env.DEBUG_SMS === 'true') {
        logger.debug({ message: params.message }, '[SLT SMS] Message Content')
      }

      // Send request to SLT SMS API using GET with query parameters
      const requestParams = {
          src: this.config.smsAlias,
          dst: normalizedMobile,
          msg: processedMessage,
          user: this.config.username,
          password: this.config.password,
          dr: 1,  // Delivery report
          type: messageType  // 0 for Text, 2 for Unicode
      };

      if (process.env.DEBUG_SMS === 'true') {
        const queryParams: Record<string, string> = {};
        Object.entries(requestParams).forEach(([k, v]) => queryParams[k] = String(v));
        const queryString = new URLSearchParams(queryParams).toString();
        logger.debug({ url: `${this.config.apiUrl}?${queryString}` }, '[SLT SMS] Full Request URL')
      }

      const response = await this.axiosInstance.get('', {
        params: requestParams
      })

      // Check response - SLT API typically returns status in response
      logger.info({ status: response.status, data: response.data }, '[SLT SMS] Response received')

      if (response.status === 200) {
        // Some SLT APIs return success: false inside a 200 response
        if (response.data && response.data.error) {
          logger.error({ error: response.data.error }, '[SLT SMS] Error reported in 200 OK')
          return { success: false, error: response.data.error }
        }
        logger.info({ to: normalizedMobile }, '[SLT SMS] Message sent successfully')
        return {
          success: true,
          messageId: response.data?.messageId || Date.now().toString()
        }
      } else {
        logger.error({ status: response.status, data: response.data }, '[SLT SMS] Server returned error')
        return {
          success: false,
          error: response.data?.error || `Server error ${response.status}`
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, '[SLT SMS] Error sending SMS')
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

    // Extract name for personalization (use full name for Super Admin)
    const firstName = userName === 'Super Admin' ? 'Super Admin' : (userName ? userName.split(' ')[0] : null)
    const greeting = firstName ? `Dear ${firstName},` : ''

    // Keep messages concise and professional
    const otpMessages = {
      en: role
        ? `SLT DQMS: ${greeting} Your ${role.en} login code is ${otpCode}. Valid for 5 minutes. Do not share this code.\n\nSLT-MOBITEL`
        : `SLT DQMS: ${greeting} Your login code is ${otpCode}. Valid for 5 minutes. Do not share this code.\n\nSLT-MOBITEL`,
      si: role
        ? `SLT DQMS: ${firstName ? `${firstName},` : ''} ඔබගේ ${role.si} කේතය ${otpCode}. මිනිත්තු 5. කේතය බෙදා නොගන්න.\n\nSLT-MOBITEL`
        : `SLT DQMS: ${firstName ? `${firstName},` : ''} ඔබගේ කේතය ${otpCode}. මිනිත්තු 5.\n\nSLT-MOBITEL`,
      ta: role
        ? `SLT DQMS: ${firstName ? `${firstName},` : ''} உங்கள் ${role.ta} குறியீடு ${otpCode}. 5 நிமிடம். பகிர வேண்டாம்.\n\nSLT-MOBITEL`
        : `SLT DQMS: ${firstName ? `${firstName},` : ''} உங்கள் குறியீடு ${otpCode}. 5 நிமிடம்.\n\nSLT-MOBITEL`
    }

    const selectedOtpMsg = this.selectMessageForSMS(otpMessages, language)
    console.log(`[SLT SMS DEBUG] Sending OTP to ${mobileNumber}, userName: "${userName}", firstName: "${firstName}", userType: "${userType}", message: "${selectedOtpMsg}" (${selectedOtpMsg.length} chars)`)

    return this.sendSMS({
      to: mobileNumber,
      message: selectedOtpMsg
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
      message: this.selectMessageForSMS(messages, language)
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
      message: this.selectMessageForSMS(messages, language)
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
      message: this.selectMessageForSMS(messages, language)
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
      si: `ගරු පාරිභෝගිකයා\n\nසේවාවේ ප්‍රමාදයක් ඇත. ඔබගේ ටෝකන් අංකය ${formattedToken} ඉක්මනින් කැඳවනු ලැබේ. ඔබගේ ඉවසීමට ස්තුතියි.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nசேவையில் தாமதம் உள்ளது. உங்கள் டோக்கன் எண் ${formattedToken} விரைவில் அழைக்கப்படும். உங்கள் பொறுமைக்கு நன்றி.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: this.selectMessageForSMS(messages, language)
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
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} is now being called. Please proceed to Counter ${counterNumber} for your service.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nඔබගේ ටෝකන් අංකය ${formattedToken} සඳහා දැන් කැඳවනු ලැබේ. කරුණාකර ඔබගේ සේවාව සඳහා කවුන්ටර් ${counterNumber} වෙත පැමිණෙන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nஉங்கள் டோக்கன் எண் ${formattedToken} தற்போது அழைக்கப்படுகிறது. தயவுசெய்து உங்கள் சேவைக்காக கவுண்டர் ${counterNumber} க்கு செல்லவும்.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: this.selectMessageForSMS(messages, language)
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
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `Dear Valued Customer\n\nYour SLT account ${billDetails.accountNumber} has an outstanding balance of Rs. ${billDetails.amount}. Please settle the bill by ${billDetails.dueDate} to avoid service interruption.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nඔබගේ SLT ගිණුම ${billDetails.accountNumber} හි හිඟ ශේෂය රු. ${billDetails.amount} කි. සේවා බාධාවන් වළක්වා ගැනීමට කරුණාකර ${billDetails.dueDate} දිනට පෙර බිල්පත ගෙවන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nஉங்கள் SLT கணக்கு ${billDetails.accountNumber} இல் ரூ. ${billDetails.amount} நிலுவைத் தொகை உள்ளது. சேவைத் தடையைத் தவிர்க்க தயவுசெய்து ${billDetails.dueDate} க்குள் கட்டணத்தைச் செலுத்தவும்.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: this.selectMessageForSMS(messages, language)
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

    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active. Please proceed to Counter ${details.counterNumber} immediately.\n\nSLT-Mobitel`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} සඳහා දැන් කැඳවනු ලැබේ. කරුණාකර කවුන්ටර් ${details.counterNumber} වෙත පැමිණෙන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} தற்போது அழைக்கப்படுகிறது. தயவுசெய்து கவுண்டர் ${details.counterNumber} க்கு செல்லவும்.\n\nSLT-MOBITEL`
    }

    const selectedCallMsg = this.selectMessageForSMS(messages, language)
    console.log(`[SLT SMS CALL] Message content (${selectedCallMsg.length} chars): ${selectedCallMsg}`)

    return this.sendSMS({
      to: mobileNumber,
      message: selectedCallMsg
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
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} was skipped as you were not available. Please visit the counter to be recalled.\n\nSLT-Mobitel`,
      si: `ගරු පාරිභෝගිකයා\n\nඔබ එම අවස්ථාවේ නොසිටි බැවින් ${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} මග හැරී ඇත. නැවත කැඳවීම සඳහා කරුණාකර කවුන්ටරය වෙත පැමිණෙන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nநீங்கள் அங்கு இல்லாததால் ${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} தவிர்க்கப்பட்டது. மீண்டும் அழைக்கப்பட தயவுசெய்து கவுண்டருக்கு வரவும்.\n\nSLT-MOBITEL`
    }

    const selectedSkipMsg = this.selectMessageForSMS(messages, language)
    console.log(`[SLT SMS SKIP] Message content (${selectedSkipMsg.length} chars): "${selectedSkipMsg}"`)

    return this.sendSMS({
      to: mobileNumber,
      message: selectedSkipMsg
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
      counterNumber?: number
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS RECALL] Attempting to send recall SMS to ${mobileNumber} for token #${details.tokenNumber}`)

    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')

    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is being recalled. Please proceed to Counter ${details.counterNumber || 'the assigned counter'} immediately.\n\nSLT-Mobitel`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} නැවත කැඳවනු ලැබේ. කරුණාකර වහාම කවුන්ටර් ${details.counterNumber || 'අදාළ'} වෙත පැමිණෙන්න.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} மீண்டும் அழைக்கப்படுகிறது. தயவுசெய்து உடனடியாக கவுண்டர் ${details.counterNumber || ''} க்கு செல்லவும்.\n\nSLT-MOBITEL`
    }

    const selectedRecallMsg = this.selectMessageForSMS(messages, language)
    console.log(`[SLT SMS RECALL] Message content (${selectedRecallMsg.length} chars): "${selectedRecallMsg}"`)

    return this.sendSMS({
      to: mobileNumber,
      message: selectedRecallMsg
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
      outletName: string
      trackingUrl?: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS COMPLETE] Attempting to send service completion SMS to ${mobileNumber} for ref ${details.refNumber}`)

    // Format token number to 3 digits if provided
    const formattedToken = details.tokenNumber ? details.tokenNumber.toString().padStart(3, '0') : null

    const fullMessages = {
      en: this.buildServiceCompletionFull(details, formattedToken, 'en'),
      si: this.buildServiceCompletionFull(details, formattedToken, 'si'),
      ta: this.buildServiceCompletionFull(details, formattedToken, 'ta')
    }

    const compactMessages = {
      en: this.buildServiceCompletionCompact(details, formattedToken, 'en'),
      si: this.buildServiceCompletionCompact(details, formattedToken, 'si'),
      ta: this.buildServiceCompletionCompact(details, formattedToken, 'ta')
    }

    // Always use English: Unicode (Sinhala/Tamil) multi-part SMS is not reliably
    // delivered by the SLT gateway (same limitation as OTP messages).
    let finalMessage = fullMessages.en

    if (finalMessage.length > 160) {
      console.warn(`[SLT SMS COMPLETE] Full message too long (${finalMessage.length}), trying compact version.`)
      if (compactMessages.en.length < finalMessage.length) {
        finalMessage = compactMessages.en
      }
    }

    console.log(`[SLT SMS COMPLETE] Final message (${finalMessage.length} chars): "${finalMessage}"`)

    if (finalMessage.length > 160) {
      console.warn(`[SLT SMS COMPLETE] Warning: Even compact version exceeds 160 chars (${finalMessage.length}).`)
    }

    const result = await this.sendSMS({
      to: mobileNumber,
      message: finalMessage
    })

    // When a tracking URL was sent as SMS 1, send a second SMS with a thank-you +
    // feedback review link so the customer gets both the status URL and an invitation
    // to rate their experience as separate, readable messages.
    if (details.trackingUrl && details.feedbackUrl) {
      const outlet = details.outletName
      const tokenDisplay = formattedToken || ''
      const thankYouFull = `Dear Valued Customer\n\nToken ${tokenDisplay} at ${outlet} served. Thank you for choosing SLT-MOBITEL! Rate: ${details.feedbackUrl}\n\nSLT-MOBITEL`
      // If outlet name makes it too long, drop it from the thank-you SMS
      const thankYouMsg = thankYouFull.length <= 160
        ? thankYouFull
        : `Dear Valued Customer\n\nToken ${tokenDisplay} served. Thank you for choosing SLT-MOBITEL! Rate: ${details.feedbackUrl}\n\nSLT-MOBITEL`
      console.log(`[SLT SMS COMPLETE] Sending thank-you+review SMS (${thankYouMsg.length} chars): "${thankYouMsg}"`)
      await this.sendSMS({ to: mobileNumber, message: thankYouMsg })
    }

    return result
  }

  // Refined helpers for completion messages
  private buildServiceCompletionFull(details: any, token: string | null, language: string) {
    if (details.trackingUrl) {
      // When a tracking URL is included, drop the greeting/closing to stay within the
      // 160-char GSM-7 limit that the SLT SMS gateway enforces for reliable delivery.
      const outlet = details.outletName.replace(/\s*(SLT|Mobitel|Office)\s*/gi, '').trim() || details.outletName
      const withOutlet = `Token ${token} at ${outlet} served.\nTrack: ${details.trackingUrl}`
      if (withOutlet.length <= 160) return withOutlet
      // Fallback: omit outlet name if even the compact form is too long
      return `Token ${token} served.\nTrack: ${details.trackingUrl}`
    }

    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${token} at ${details.outletName} has been served. Ref: ${details.refNumber || token}\n\nThank you for choosing SLT-MOBITEL.`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${token} සේවා අවසන් විය. Ref: ${details.refNumber || token}\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${token} சேவை முடிந்தது. Ref: ${details.refNumber || token}\n\nSLT-MOBITEL`
    }
    return (messages as any)[language] || messages.en
  }

  private buildServiceCompletionCompact(details: any, token: string | null, language: string) {
    const outlet = details.outletName.replace(/\s*(SLT|Mobitel|Office)\s*/gi, '').trim() || details.outletName

    if (details.trackingUrl) {
      const withOutlet = `Token ${token} at ${outlet} served.\nTrack: ${details.trackingUrl}`
      if (withOutlet.length <= 160) return withOutlet
      return `Token ${token} served.\nTrack: ${details.trackingUrl}`
    }

    const messages = {
      en: `Dear Valued Customer\n\nToken ${token} at ${outlet} served. Ref: ${details.refNumber || token}\n\nThank you for choosing SLT-MOBITEL.`,
      si: `ගරු පාරිභෝගිකයා\n\n${outlet} හි ටෝකන් ${token} සේවා අවසන්. Ref: ${details.refNumber || token}\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${outlet} இல் டோக்கன் ${token} முடிந்தது. Ref: ${details.refNumber || token}\n\nSLT-MOBITEL`
    }
    return (messages as any)[language] || messages.en
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
    // Always send OTP in English (plain ASCII) regardless of preferred language.
    // Unicode SMS (Sinhala/Tamil) is limited to 70 chars per segment and many gateways
    // do not reliably deliver multi-part Unicode SMS, causing OTPs to be silently lost.
    const message = `Dear Valued Customer\n\nYour registration code for ${details.outletName} is ${details.otpCode}. Valid for 5 minutes.\n\nSLT-MOBITEL`

    return this.sendSMS({
      to: mobileNumber,
      message
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
    logger.info({ mobileNumber, tokenNumber: details.tokenNumber }, '[SLT SMS] sendTokenConfirmation entry')
    // Format token number to 3 digits (e.g., 001, 018, 123)
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    const hasTrackingUrl = !!details.trackingUrl

    const waitTimeText = details.estimatedWait ? ` with an estimated wait time of ${details.estimatedWait} minutes` : ''
    const fullEnglishMessage = hasTrackingUrl
      ? `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active. You are currently in position ${details.queuePosition}${waitTimeText}.\nTrack status: ${details.trackingUrl}\n\nSLT-Mobitel`
      : `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active. You are currently in position ${details.queuePosition}${waitTimeText}.\n\nSLT-Mobitel`

    const buildCompactEnglishMessage = () => {
      const statusSuffix = hasTrackingUrl ? `\nTrack status: ${details.trackingUrl}` : ''
      const prefix = `Dear Valued Customer\n\nToken ${formattedToken} at `
      const suffix = ` active. Pos: ${details.queuePosition}${statusSuffix}\n\nSLT-MOBITEL`
      const maxOutletLength = 160 - prefix.length - suffix.length
      const safeMax = Math.max(8, maxOutletLength)
      const outlet = details.outletName.length > safeMax
        ? `${details.outletName.slice(0, safeMax - 3).trimEnd()}...`
        : details.outletName

      const compact = `${prefix}${outlet}${suffix}`
      if (compact.length <= 160) return compact

      if (hasTrackingUrl) {
        const compactWithStatus = `Dear Valued Customer\n\nToken ${formattedToken} active. Pos: ${details.queuePosition}.\nTrack status: ${details.trackingUrl}\n\nSLT-MOBITEL`
        if (compactWithStatus.length <= 160) return compactWithStatus
      }

      return `Dear Valued Customer\n\nToken ${formattedToken} active. Pos: ${details.queuePosition}.\n\nSLT-MOBITEL`
    }

    const messages = {
      en: fullEnglishMessage.length <= 160 ? fullEnglishMessage : buildCompactEnglishMessage(),
      si: hasTrackingUrl
        ? `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} දැන් සක්‍රීයයි (පෝලිමේ ස්ථානය: ${details.queuePosition}).\n\nතත්ත්වය පරීක්ෂා කරන්න: ${details.trackingUrl}\n\nSLT-MOBITEL`
        : `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} දැන් සක්‍රීයයි (පෝලිමේ ස්ථානය: ${details.queuePosition}).\n\nSLT-MOBITEL`,
      ta: hasTrackingUrl
        ? `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} இப்போது செயலில் உள்ளது (வரிசை நிலை: ${details.queuePosition}).\n\nநிலை: ${details.trackingUrl}\n\nSLT-MOBITEL`
        : `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} இப்போது செயலில் உள்ளது (வரிசை நிலை: ${details.queuePosition}).\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: this.selectMessageForSMS(messages, language)
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

    const waitTimeText = details.estimatedWait ? ` with an estimated wait time of ${details.estimatedWait} minutes` : ''
    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} is now active. You are currently in position 1${waitTimeText}.\n\nSLT-Mobitel`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} දැන් සක්‍රීයයි (පෝලිමේ ස්ථානය: 1).\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} இப்போது செயலில் உள்ளது (வரிசை நிலை: 1).\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: this.selectMessageForSMS(messages, language)
    })
  }

  /**
   * Send token transfer notification
   */
  async sendTokenTransfer(
    mobileNumber: string,
    details: {
      tokenNumber: number
      outletName: string
      serviceNames: string
      targetCounterNumber?: number
      recoveryUrl?: string
      refNumber?: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    console.log(`[SLT SMS TRANSFER] Preparing transfer SMS for token #${details.tokenNumber} to ${mobileNumber}`)

    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    const refSuffix = details.refNumber ? ` Ref: ${details.refNumber.split('/').pop()}` : ""
    const trackSuffix = details.recoveryUrl ? ` Track: ${details.recoveryUrl}` : ""

    const buildFullMessages = () => {
      const trackPart = details.recoveryUrl ? `\nTrack: ${details.recoveryUrl}` : ""
      return {
        en: details.targetCounterNumber
          ? `Dear Valued Customer\n\nYour token ${formattedToken} at ${details.outletName} has been transferred to Counter ${details.targetCounterNumber} for ${details.serviceNames}. Please proceed for further assistance.${trackPart}\n\nSLT-Mobitel`
          : `Dear Valued Customer\n\nYour token ${formattedToken} at ${details.outletName} has been transferred for ${details.serviceNames}. Please wait for your turn.${trackPart}\n\nSLT-Mobitel`,
        si: details.targetCounterNumber
          ? `SLT-MOBITEL DQMS: පාරිභෝගිකයාණනි, ඔබගේ ටෝකන් අංකය ${formattedToken}, ${details.outletName} හිදී කවුන්ටර් ${details.targetCounterNumber} වෙත මාරු කරන ලදී (${details.serviceNames}). කරුණාකර නව කවුන්ටරය වෙත පැමිණෙන්න.${trackPart}\n\nSLT-MOBITEL`
          : `SLT-MOBITEL DQMS: පාරිභෝගිකයාණනි, ඔබගේ ටෝකන් ${formattedToken}, ${details.outletName} හිදී ${details.serviceNames} සඳහා මාරු කරන ලදී. කරුණාකර ඊළඟ කවුන්ටරය තෙක් රැඳී සිටින්න.${trackPart}\n\nSLT-MOBITEL`,
        ta: details.targetCounterNumber
          ? `SLT-MOBITEL DQMS: அன்புமிகு வாடிக்கையாளரே, உங்களின் டோக்கன் எண் ${formattedToken}, ${details.outletName} இல் கவுண்டர் ${details.targetCounterNumber} க்கு மாற்றப்பட்டுள்ளது (${details.serviceNames}). தயவுசெய்து புதிய கவுண்டருக்குச் செல்லவும்.${trackPart}\n\nSLT-MOBITEL`
          : `SLT-MOBITEL DQMS: அன்புமிகு வாடிக்கையாளரே, உங்களின் டோக்கன் எண் ${formattedToken}, ${details.outletName} இல் ${details.serviceNames} க்காக மாற்றப்பட்டுள்ளது. தயவுசெய்து அடுத்த கவுண்டருக்காக காத்திருக்கவும்.${trackPart}\n\nSLT-MOBITEL`
      }
    }

    const buildCompactMessages = () => {
      const trackOnly = details.recoveryUrl ? `\nTrack: ${details.recoveryUrl}` : ""
      return {
        en: details.targetCounterNumber
          ? `SLT-MOBITEL DQMS: Token ${formattedToken} transferred to Counter ${details.targetCounterNumber} for ${details.serviceNames}.${trackOnly}\n\nSLT-MOBITEL`
          : `SLT-MOBITEL DQMS: Token ${formattedToken} transferred for ${details.serviceNames}.${trackOnly}\n\nSLT-MOBITEL`,
        si: details.targetCounterNumber
          ? `SLT-MOBITEL DQMS: ටෝකන් ${formattedToken}, කවුන්ටර් ${details.targetCounterNumber} වෙත මාරු කරන ලදී.${trackOnly}\n\nSLT-MOBITEL`
          : `SLT-MOBITEL DQMS: ටෝකන් ${formattedToken} මාරු කරන ලදී.${trackOnly}\n\nSLT-MOBITEL`,
        ta: details.targetCounterNumber
          ? `SLT-MOBITEL DQMS: டோக்கன் ${formattedToken} கவுண்டர் ${details.targetCounterNumber} க்கு மாற்றப்பட்டது.${trackOnly}\n\nSLT-MOBITEL`
          : `SLT-MOBITEL DQMS: டோக்கன் ${formattedToken} மாற்றப்பட்டது.${trackOnly}\n\nSLT-MOBITEL`
      }
    }

    const fullMessages = buildFullMessages()
    // Always use English: Unicode (Sinhala/Tamil) multi-part SMS is not reliably
    // delivered by the SLT gateway (same limitation as OTP messages).
    let finalMessage = fullMessages.en

    if (finalMessage.length > 160) {
      console.warn(`[SLT SMS TRANSFER] Full message too long (${finalMessage.length}), trying compact version.`)
      const compactMessages = buildCompactMessages()
      if (compactMessages.en.length < finalMessage.length) {
        finalMessage = compactMessages.en
      }
    }

    console.log(`[SLT SMS TRANSFER] Final message (${finalMessage.length} chars): "${finalMessage}"`)

    if (finalMessage.length > 160) {
      console.warn(`[SLT SMS TRANSFER] Warning: Even compact message exceeds 160 chars (${finalMessage.length}).`)
    }

    return this.sendSMS({
      to: mobileNumber,
      message: finalMessage
    })
  }

  /**
   * Send welcome SMS to newly registered staff member (GM, DGM, RTOM, Manager, Officer)
   * IMPORTANT: SMS must be ≤160 chars for single-part delivery on SLT gateway.
   */
  async sendStaffWelcomeSMS(
    mobileNumber: string,
    details: {
      name: string;
      role: string;
      loginUrl: string;
    }
  ): Promise<SMSResponse> {
    // Use first name only to save space
    const firstName = details.name.split(' ')[0]

    // Abbreviate long role names to keep message short
    const roleAbbr: Record<string, string> = {
      'Customer Service Officer': 'CSO',
      'Teleshop Manager': 'Teleshop Mgr',
      'General Manager': 'GM',
      'Deputy General Manager': 'DGM',
    }
    const roleLabel = roleAbbr[details.role] || details.role

    // Build a compact message that stays within 160 chars
    // Format: "SLT DQMS: Hi [Name], your [Role] account is active. Login: [URL] SLT-MOBITEL"
    const message = `SLT DQMS: Hi ${firstName}, your ${roleLabel} account is active. Login: ${details.loginUrl} SLT-MOBITEL`

    // Log warning if still too long
    if (message.length > 160) {
      console.warn(`[SLT SMS] Staff welcome SMS is ${message.length} chars (>160). May be split or rejected. Consider shortening the login URL.`)
    } else {
      console.log(`[SLT SMS] Staff welcome SMS: ${message.length} chars`)
    }

    return this.sendSMS({
      to: mobileNumber,
      message
    });
  }

  /**
   * Send token cancellation notification
   */
  async sendTokenCancellation(
    mobileNumber: string,
    details: {
      tokenNumber: number
      outletName: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    const messages = {
      en: `Dear Valued Customer\n\nYour token number ${formattedToken} at ${details.outletName} has been cancelled successfully. Thank you for choosing SLT-MOBITEL.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\n${details.outletName} හි ඔබගේ ටෝකන් අංකය ${formattedToken} සාර්ථකව අවලංගු කර ඇත. SLT-MOBITEL තෝරා ගැනීම ගැන ස්තුතියි.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\n${details.outletName} இல் உங்கள் டோக்கன் எண் ${formattedToken} வெற்றிகரமாக ரத்து செய்யப்பட்டது. SLT-MOBITEL ஐத் தேர்ந்தெடுத்தமைக்கு நன்றி.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: this.selectMessageForSMS(messages, language)
    })
  }

  /**
   * Select the appropriate message for SMS delivery.
   * Falls back to English when the target language produces a Unicode message
   * that exceeds the 70-character single-segment limit, because the SLT gateway
   * does not reliably deliver multi-part Unicode SMS.
   */
  private selectMessageForSMS(
    messages: { en: string; si: string; ta: string },
    language: 'en' | 'si' | 'ta'
  ): string {
    // Force English for all SMS delivery to avoid Unicode encoding issues (hex codes)
    // as requested by the user. The dashboard UI will still remain localized.
    return messages.en
  }


  /**
   * Send bill payment confirmation SMS when CSO marks the payment as complete
   */
  async sendBillPaymentConfirmation(
    mobileNumber: string,
    details: {
      firstName: string
      tokenNumber: number
      outletName: string
      refNumber: string
      paymentIntent: string   // 'full' | 'partial' | 'not_specified'
      paymentAmount?: number  // amount paid (due amount for full, custom for partial)
      paymentMethod?: string  // 'cash' | 'card' | 'cheque' | 'bank_transfer'
      trackingUrl?: string    // full URL for customer to track the service case
      feedbackUrl?: string    // full URL for customer to leave a review
    }
  ): Promise<SMSResponse> {
    const formattedToken = details.tokenNumber.toString().padStart(3, '0')
    const outlet = details.outletName.replace(/\s*(SLT|Mobitel|Office)\s*/gi, '').trim() || details.outletName

    const methodLabels: Record<string, string> = {
      cash: 'Cash',
      card: 'Card',
      cheque: 'Cheque',
      bank_transfer: 'Bank Transfer'
    }
    const methodLabel = details.paymentMethod ? (methodLabels[details.paymentMethod] || details.paymentMethod) : ''

    let paymentLine = ''
    if (details.paymentIntent === 'full' && details.paymentAmount != null && details.paymentAmount > 0) {
      paymentLine = `Rs. ${details.paymentAmount.toFixed(2)} (Full Payment)`
    } else if (details.paymentIntent === 'partial' && details.paymentAmount != null && details.paymentAmount > 0) {
      paymentLine = `Rs. ${details.paymentAmount.toFixed(2)} (Partial Payment)`
    }

    const methodPart = methodLabel ? ` via ${methodLabel}` : ''
    const amountPart = paymentLine ? `\nAmount: ${paymentLine}${methodPart}` : (methodLabel ? `\nPayment Method: ${methodLabel}` : '')

    let message: string
    if (details.trackingUrl) {
      // Never show method label alone when there is no amount — it's meaningless without a figure.
      const amountCompact = paymentLine
        ? `\n${paymentLine.replace('Full Payment', 'Full').replace('Partial Payment', 'Partial')}${methodPart}`
        : ''
      // Prefer the full "Dear Valued Customer" greeting, but the primary tracking URL (e.g. SLT srv)
      // pushes the total past the 160-char GSM-7 limit the SLT gateway silently drops.
      // Fall back progressively: drop greeting first, then drop footer, to stay deliverable.
      const withGreeting = `Dear Valued Customer\nBill payment complete.${amountCompact}\nTrack: ${details.trackingUrl}\n\nSLT-MOBITEL`
      if (withGreeting.length <= 160) {
        message = withGreeting
      } else {
        // Dropping "Dear Valued Customer\n" saves 21 chars; SLT-MOBITEL branding is kept.
        const noGreeting = `Bill payment complete.${amountCompact}\nTrack: ${details.trackingUrl}\n\nSLT-MOBITEL`
        message = noGreeting.length <= 160 ? noGreeting : `Bill payment complete.\nTrack: ${details.trackingUrl}`
      }
    } else {
      const trackLine = `\nRef: ${details.refNumber}`
      message = `Dear Valued Customer\n\nYour bill payment at ${outlet} has been completed.${amountPart}${trackLine}\n\nThank you for choosing SLT-MOBITEL.`
    }

    console.log(`[SLT SMS PAYMENT] Sending bill payment confirmation to ${mobileNumber}: "${message}"`)

    const result = await this.sendSMS({ to: mobileNumber, message })

    // Send a second SMS with a thank-you + review invitation (same pattern as service completion).
    if (details.trackingUrl && details.feedbackUrl) {
      const formattedToken = details.tokenNumber.toString().padStart(3, '0')
      const thankYouFull = `Dear Valued Customer\n\nThank you for choosing SLT-MOBITEL! Rate your experience: ${details.feedbackUrl}\n\nSLT-MOBITEL`
      const thankYouMsg = thankYouFull.length <= 160
        ? thankYouFull
        : `Thank you for choosing SLT-MOBITEL! Rate: ${details.feedbackUrl}`
      console.log(`[SLT SMS PAYMENT] Sending thank-you+review SMS (${thankYouMsg.length} chars): "${thankYouMsg}"`)
      await this.sendSMS({ to: mobileNumber, message: thankYouMsg })
    }

    return result
  }

  /**
   * Check service availability
   */
  isConfigured(): boolean {
    return !!(this.config.username && this.config.password && this.config.smsAlias)
  }

  /**
   * Send appointment cancellation notification
   */
  async sendAppointmentCancellation(
    mobileNumber: string,
    details: {
      outletName: string
      dateTime: string
    },
    language: 'en' | 'si' | 'ta' = 'en'
  ): Promise<SMSResponse> {
    const messages = {
      en: `Dear Valued Customer\n\nYour appointment at ${details.outletName} for ${details.dateTime} has been cancelled as requested.\n\nSLT-MOBITEL`,
      si: `ගරු පාරිභෝගිකයා\n\nඔබගේ ඉල්ලීම පරිදි ${details.outletName} හි ${details.dateTime} සඳහා වූ හමුව අවලංගු කර ඇත.\n\nSLT-MOBITEL`,
      ta: `அன்பு வாடிக்கையாளரே\n\nஉங்கள் வேண்டுகோளின்படி ${details.outletName} இல் ${details.dateTime} க்கான உங்கள் சந்திப்பு ரத்து செய்யப்பட்டது.\n\nSLT-MOBITEL`
    }

    return this.sendSMS({
      to: mobileNumber,
      message: this.selectMessageForSMS(messages, language)
    })
  }
}

// Export singleton instance
export default new SLTSmsService()
