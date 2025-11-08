import { Router } from 'express'
import twilio from 'twilio'

const router = Router()

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const fromNumber = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || ''
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || ''

const client = twilio(accountSid as string, authToken as string)

// Send a test SMS. Body: { to: string, body?: string }
router.post('/test', async (req, res) => {
  try {
    const { to, body: messageBody = 'Test message from DQMS' } = req.body
    
    if (!to) {
      return res.status(400).json({ error: 'Missing required field: to' })
    }

    // If a Messaging Service SID is configured, prefer it (handles sender ID / country rules)
    const createParams: any = { to, body: messageBody }
    if (messagingServiceSid) {
      createParams.messagingServiceSid = messagingServiceSid
    } else if (fromNumber) {
      createParams.from = fromNumber
    }

    const msg = await client.messages.create(createParams)
    return res.json({ success: true, sid: msg.sid })
  } catch (error: any) {
    console.error('Twilio send error:', error)
    // If Twilio provided structured error info, forward it to the client for troubleshooting
    const resp: any = {
      error: error?.message || 'Failed to send SMS',
    }
    if (error?.code) resp.code = error.code
    if (error?.status) resp.status = error.status
    if (error?.moreInfo) resp.moreInfo = error.moreInfo
    return res.status(error?.status || 500).json(resp)
  }
})

export default router
