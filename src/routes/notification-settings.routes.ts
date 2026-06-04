import { Router } from 'express'
import * as jwt from 'jsonwebtoken'
import sltSmsService from '../services/sltSmsService'
import emailService from '../services/emailService'
import {
  getNotificationSettings,
  upsertNotificationSetting,
  sendDailySummaries,
} from '../services/dailySummaryService'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

// ─── Admin authentication middleware ────────────────────────────────────────
const authenticateAdmin = (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. No token provided.' })
    }
    const token = authHeader.substring(7)
    const decoded = (jwt as any).verify(token, JWT_SECRET as jwt.Secret)
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' })
    }
    req.user = decoded
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token.' })
  }
}

router.use(authenticateAdmin)

// ─── GET /api/admin/notification-settings ───────────────────────────────────
// Returns all notification settings with sensible defaults
router.get('/', async (_req, res) => {
  try {
    const raw = await getNotificationSettings()

    const settings = {
      daily_summary_sms_enabled: raw['daily_summary_sms_enabled'] ?? 'false',
      daily_summary_email_enabled: raw['daily_summary_email_enabled'] ?? 'false',
      daily_summary_hour: raw['daily_summary_hour'] ?? '19',
      daily_summary_minute: raw['daily_summary_minute'] ?? '0',
    }

    res.json({ success: true, settings })
  } catch (error: any) {
    console.error('[NotificationSettings] GET error:', error)
    res.status(500).json({ error: 'Failed to fetch notification settings' })
  }
})

// ─── PUT /api/admin/notification-settings ───────────────────────────────────
// Bulk-upsert notification settings
router.put('/', async (req, res) => {
  try {
    const allowed = [
      'daily_summary_sms_enabled',
      'daily_summary_email_enabled',
      'daily_summary_hour',
      'daily_summary_minute',
    ]

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await upsertNotificationSetting(key, String(req.body[key]))
      }
    }

    const updated = await getNotificationSettings()
    res.json({ success: true, message: 'Settings saved successfully', settings: updated })
  } catch (error: any) {
    console.error('[NotificationSettings] PUT error:', error)
    res.status(500).json({ error: 'Failed to update notification settings' })
  }
})

// ─── POST /api/admin/notification-settings/test-sms ─────────────────────────
// Send a test SMS to a specified mobile number
router.post('/test-sms', async (req, res) => {
  try {
    const { mobileNumber } = req.body
    if (!mobileNumber) {
      return res.status(400).json({ error: 'Mobile number is required' })
    }

    let managerName = 'Manager'
    let branchName = 'Test Branch'

    try {
      const { PrismaClient } = require('@prisma/client')
      const prisma = new PrismaClient()
      const manager = await prisma.teleshopManager.findUnique({ where: { mobileNumber } })
      if (manager) {
        managerName = manager.name
        if (manager.branchId) {
          const outlet = await prisma.outlet.findUnique({ where: { id: manager.branchId } })
          if (outlet) branchName = outlet.name
        }
      }
      await prisma.$disconnect()
    } catch (e) {
      console.error('[NotificationSettings] Failed to fetch manager details for test sms:', e)
    }

    const nameParts = managerName.trim().split(' ')
    const displayName = nameParts.slice(0, 2).join(' ')

    const message = [
      `Dear ${displayName},`,
      '',
      `Daily Summary - ${branchName}`,
      `Date: ${new Date().toLocaleDateString('en-GB')}`,
      '',
      'Tokens Issued    : 45',
      'Customers Served : 38',
      'Avg Wait Time    : 9 mins',
      'Avg Service Time : 14 mins',
      'Customer Rating  : 4.3 / 5',
      '',
      'SLT-MOBITEL',
    ].join('\n')

    const result = await sltSmsService.sendSMS({ to: mobileNumber, message })

    if (result.success) {
      res.json({ success: true, message: `Test SMS sent to ${mobileNumber}` })
    } else {
      res.status(500).json({ success: false, error: result.error || 'Failed to send test SMS' })
    }
  } catch (error: any) {
    console.error('[NotificationSettings] Test SMS error:', error)
    res.status(500).json({ error: 'Failed to send test SMS' })
  }
})

// ─── POST /api/admin/notification-settings/test-email ───────────────────────
// Send a test email to a specified address
router.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' })
    }

    let managerName = 'Manager'
    let branchName = 'Sample Teleshop Branch'

    try {
      const { PrismaClient } = require('@prisma/client')
      const prisma = new PrismaClient()
      const manager = await prisma.teleshopManager.findFirst({ where: { email } })
      if (manager) {
        managerName = manager.name
        if (manager.branchId) {
          const outlet = await prisma.outlet.findUnique({ where: { id: manager.branchId } })
          if (outlet) branchName = outlet.name
        }
      }
      await prisma.$disconnect()
    } catch (e) {
      console.error('[NotificationSettings] Failed to fetch manager details for test email:', e)
    }

    const date = new Date().toLocaleDateString('en-GB')
    const subject = `[TEST] Daily Branch Summary – ${branchName} | ${date}`

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#1e293b;">
  <div style="max-width:620px;margin:32px auto;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.12);">
    <div style="background:linear-gradient(135deg,#1e40af 0%,#0056b3 100%);padding:36px 32px;text-align:center;">
      <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;letter-spacing:1px;text-transform:uppercase;">SLT-MOBITEL</p>
      <h1 style="margin:8px 0 4px;color:#ffffff;font-size:22px;font-weight:700;">Daily Branch Summary</h1>
      <p style="margin:0;color:rgba(255,255,255,0.8);font-size:14px;">${branchName} &nbsp;|&nbsp; ${date}</p>
    </div>
    <div style="background:#ffffff;padding:28px 32px 16px;">
      <p style="margin:0 0 8px;font-size:16px;">Dear <strong>${managerName}</strong>,</p>
      <p style="margin:0;color:#64748b;font-size:14px;line-height:1.6;">
        This is a <strong>test email</strong> for the Daily Branch Summary notification. Below is a sample of what your daily report will look like.
      </p>
    </div>
    <div style="background:#ffffff;padding:8px 32px 24px;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.8px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">📊 Performance Summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>
          <tr style="background:#f8fafc;"><td style="padding:11px 14px;color:#64748b;">Tokens Issued</td><td style="padding:11px 14px;text-align:right;font-weight:700;color:#0f172a;">45</td></tr>
          <tr style="background:#fff;"><td style="padding:11px 14px;color:#64748b;">Customers Served</td><td style="padding:11px 14px;text-align:right;font-weight:700;color:#0f172a;">38</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:11px 14px;color:#64748b;">Avg Wait Time</td><td style="padding:11px 14px;text-align:right;font-weight:700;color:#0f172a;">9 mins</td></tr>
          <tr style="background:#fff;"><td style="padding:11px 14px;color:#64748b;">Avg Service Time</td><td style="padding:11px 14px;text-align:right;font-weight:700;color:#0f172a;">14 mins</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:11px 14px;color:#64748b;">Customer Rating</td><td style="padding:11px 14px;text-align:right;font-weight:700;color:#0f172a;">4.3 / 5 ⭐</td></tr>
          <tr style="background:#fff;"><td style="padding:11px 14px;color:#64748b;">Peak Hour</td><td style="padding:11px 14px;text-align:right;font-weight:700;color:#0f172a;">10:00</td></tr>
        </tbody>
      </table>
    </div>
    <div style="background:#ffffff;padding:8px 32px 28px;text-align:center;">
      <p style="margin:0 0 16px;color:#64748b;font-size:13px;">For detailed insights, please log in to the DQMS Portal.</p>
      <a href="${process.env.FRONTEND_BASE_URL || 'https://sltsecmanage.slt.lk:7443'}/teleshop-manager/dashboard"
         style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        View Full Dashboard
      </a>
    </div>
    <div style="background:#0f172a;padding:20px 32px;text-align:center;">
      <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">SLT-MOBITEL</p>
      <p style="margin:0;color:#475569;font-size:11px;">Digital Queue Management System</p>
      <p style="margin:8px 0 0;color:#475569;font-size:10px;">This is an automated daily summary. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`

    const text = `Dear ${managerName},\n\nThis is a test email for the Daily Branch Summary notification for ${branchName}.\n\nBest regards,\nSLT-MOBITEL\nDigital Queue Management System`

    const result = await emailService.sendRawEmail({ to: email, subject, text, html })

    if (result) {
      res.json({ success: true, message: `Test email sent to ${email}` })
    } else {
      res.status(500).json({ success: false, error: 'Failed to send test email' })
    }
  } catch (error: any) {
    console.error('[NotificationSettings] Test email error:', error)
    res.status(500).json({ error: 'Failed to send test email: ' + error.message })
  }
})

// ─── POST /api/admin/notification-settings/send-now ─────────────────────────
// Manually trigger daily summary for all active teleshop managers
router.post('/send-now', async (_req, res) => {
  try {
    console.log('[NotificationSettings] Manual daily summary triggered by admin')
    const results = await sendDailySummaries()

    const sent = results.filter(r => r.smsStatus === 'sent' || r.emailStatus === 'sent').length
    const failed = results.filter(r => r.smsStatus === 'failed' || r.emailStatus === 'failed').length
    const skipped = results.filter(r => r.smsStatus === 'skipped' && r.emailStatus === 'skipped').length

    res.json({
      success: true,
      message: `Daily summary dispatched. ${sent} sent, ${failed} failed, ${skipped} skipped.`,
      results,
    })
  } catch (error: any) {
    console.error('[NotificationSettings] Send-now error:', error)
    res.status(500).json({ error: 'Failed to send daily summaries: ' + error.message })
  }
})

export default router
