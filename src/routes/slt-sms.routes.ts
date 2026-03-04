import { Router } from 'express'
import sltSmsService from '../services/sltSmsService'

const router = Router()

/**
 * Send a test SMS using SLT SMS Gateway
 * POST /api/slt-sms/test
 * Body: { to: string, message?: string }
 */
router.post('/test', async (req, res) => {
  try {
    const { to, message = 'This is a test message from DQMS' } = req.body

    if (!to) {
      return res.status(400).json({ error: 'Missing required field: to' })
    }

    // Check if SLT SMS is configured
    if (!sltSmsService.isConfigured()) {
      return res.status(503).json({ 
        error: 'SLT SMS service is not configured',
        details: 'Please set SLT_SMS_USERNAME, SLT_SMS_PASSWORD, and SLT_SMS_ALIAS in environment variables'
      })
    }

    const result = await sltSmsService.sendSMS({ to, message })

    if (result.success) {
      return res.json({ 
        success: true, 
        messageId: result.messageId,
        to,
        message 
      })
    } else {
      return res.status(500).json({ 
        error: result.error || 'Failed to send SMS',
        success: false 
      })
    }
  } catch (error: any) {
    console.error('SLT SMS test error:', error)
    return res.status(500).json({ 
      error: error.message || 'Failed to send SMS',
      success: false 
    })
  }
})

/**
 * Send OTP SMS
 * POST /api/slt-sms/send-otp
 * Body: { to: string, otpCode: string, language?: 'en' | 'si' | 'ta' }
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { to, otpCode, language = 'en' } = req.body

    if (!to || !otpCode) {
      return res.status(400).json({ error: 'Missing required fields: to, otpCode' })
    }

    const result = await sltSmsService.sendOTP(to, otpCode, language)

    if (result.success) {
      return res.json({ 
        success: true, 
        messageId: result.messageId 
      })
    } else {
      return res.status(500).json({ 
        error: result.error || 'Failed to send OTP',
        success: false 
      })
    }
  } catch (error: any) {
    console.error('SLT SMS OTP error:', error)
    return res.status(500).json({ 
      error: error.message || 'Failed to send OTP',
      success: false 
    })
  }
})

/**
 * Send appointment confirmation SMS
 * POST /api/slt-sms/send-appointment
 * Body: { to: string, appointmentDetails: object, language?: 'en' | 'si' | 'ta' }
 */
router.post('/send-appointment', async (req, res) => {
  try {
    const { to, appointmentDetails, language = 'en' } = req.body

    if (!to || !appointmentDetails) {
      return res.status(400).json({ error: 'Missing required fields: to, appointmentDetails' })
    }

    const result = await sltSmsService.sendAppointmentConfirmation(to, appointmentDetails, language)

    if (result.success) {
      return res.json({ 
        success: true, 
        messageId: result.messageId 
      })
    } else {
      return res.status(500).json({ 
        error: result.error || 'Failed to send appointment confirmation',
        success: false 
      })
    }
  } catch (error: any) {
    console.error('SLT SMS appointment error:', error)
    return res.status(500).json({ 
      error: error.message || 'Failed to send appointment confirmation',
      success: false 
    })
  }
})

/**
 * Send token ready notification
 * POST /api/slt-sms/send-token-ready
 * Body: { to: string, tokenNumber: number, counterNumber: number, language?: 'en' | 'si' | 'ta' }
 */
router.post('/send-token-ready', async (req, res) => {
  try {
    const { to, tokenNumber, counterNumber, language = 'en' } = req.body

    if (!to || !tokenNumber || !counterNumber) {
      return res.status(400).json({ error: 'Missing required fields: to, tokenNumber, counterNumber' })
    }

    const result = await sltSmsService.sendTokenReady(to, tokenNumber, counterNumber, language)

    if (result.success) {
      return res.json({ 
        success: true, 
        messageId: result.messageId 
      })
    } else {
      return res.status(500).json({ 
        error: result.error || 'Failed to send token notification',
        success: false 
      })
    }
  } catch (error: any) {
    console.error('SLT SMS token ready error:', error)
    return res.status(500).json({ 
      error: error.message || 'Failed to send token notification',
      success: false 
    })
  }
})

/**
 * Check SLT SMS service status
 * GET /api/slt-sms/status
 */
router.get('/status', async (req, res) => {
  try {
    const isConfigured = sltSmsService.isConfigured()
    
    return res.json({ 
      configured: isConfigured,
      service: 'SLT SMS Gateway',
      status: isConfigured ? 'ready' : 'not configured'
    })
  } catch (error: any) {
    console.error('SLT SMS status check error:', error)
    return res.status(500).json({ 
      error: error.message || 'Failed to check status',
      configured: false 
    })
  }
})

export default router
