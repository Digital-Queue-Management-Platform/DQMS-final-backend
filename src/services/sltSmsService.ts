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
  async sendOTP(mobileNumber: string, otpCode: string, language: 'en' | 'si' | 'ta' = 'en'): Promise<SMSResponse> {
    const otpMessages = {
      en: `Your DQMS verification code is ${otpCode}. It expires in 5 minutes.`,
      si: `ඔබගේ DQMS සත්‍යාපන කේතය ${otpCode}. මිනිත්තු 5කින් කල් ඉකුත් වේ.`,
      ta: `உங்கள் DQMS சரிபார்ப்பு குறியீடு ${otpCode}. இது 5 நிமிடங்களில் காலாவதியாகிறது.`
    }

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
