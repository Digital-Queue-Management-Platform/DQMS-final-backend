import { PrismaClient } from '@prisma/client'
import sltSmsService from './sltSmsService'
import emailService from './emailService'

const prisma = new PrismaClient()

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – ensure the NotificationSetting table exists before any query
// ─────────────────────────────────────────────────────────────────────────────

async function ensureNotificationSettingTable(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "NotificationSetting" (
        "id"        TEXT NOT NULL PRIMARY KEY,
        "key"       TEXT NOT NULL UNIQUE,
        "value"     TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "NotificationSetting_key_idx" ON "NotificationSetting"("key")
    `)
  } catch (error) {
    console.error('[NotificationSetting] ensureTable error:', error)
  }
}

export async function getNotificationSettings(): Promise<Record<string, string>> {
  await ensureNotificationSettingTable()
  try {
    const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "NotificationSetting"
    `
    const map: Record<string, string> = {}
    for (const row of rows) map[row.key] = row.value
    return map
  } catch (error) {
    console.error('[NotificationSetting] get error:', error)
    return {}
  }
}

export async function upsertNotificationSetting(key: string, value: string): Promise<void> {
  await ensureNotificationSettingTable()
  try {
    const now = new Date()
    const id = require('crypto').randomUUID()
    await prisma.$executeRawUnsafe(
      `INSERT INTO "NotificationSetting" ("id","key","value","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("key") DO UPDATE SET "value"=$3,"updatedAt"=$5`,
      id, key, value, now, now
    )
  } catch (error) {
    console.error('[NotificationSetting] upsert error for key', key, ':', error)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

function getSriLankaToday(): { start: Date; end: Date; label: string } {
  const now = new Date()

  // 1. Get the current date string in Colombo (YYYY-MM-DD)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.format(now) // e.g., "2026-06-04"

  // 2. Treat that date as UTC midnight to build a base timestamp
  const colomboMidnightUTC = new Date(`${parts}T00:00:00Z`)

  // 3. Colombo is UTC+5:30. So midnight in Colombo actually happens 5.5 hours BEFORE UTC midnight.
  const offsetMs = 5.5 * 60 * 60 * 1000
  const startUTC = new Date(colomboMidnightUTC.getTime() - offsetMs)
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000 - 1)

  // 4. Format the human-readable label
  const label = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now)

  return { start: startUTC, end: endUTC, label }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data aggregation
// ─────────────────────────────────────────────────────────────────────────────

interface BranchSummary {
  branchName: string
  date: string
  tokensIssued: number
  customersServed: number
  avgWaitMins: number
  avgServiceMins: number
  avgRating: number
  peakHour: string
  topServices: { name: string; count: number }[]
  topOfficers: { name: string; served: number; rating: number }[]
}

async function buildBranchSummary(outletId: string): Promise<BranchSummary | null> {
  const { start, end, label } = getSriLankaToday()

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { name: true } })
  if (!outlet) return null

  const tokens = await prisma.token.findMany({
    where: { outletId, createdAt: { gte: start, lte: end } },
    select: {
      id: true, status: true, createdAt: true, startedAt: true, completedAt: true,
      serviceTypes: true, assignedTo: true, feedback: { select: { rating: true } },
    },
  })

  const completed = tokens.filter(t => t.status === 'completed' && t.startedAt && t.completedAt)

  const avgWait = completed.length > 0
    ? completed.reduce((sum, t) => sum + (t.startedAt!.getTime() - t.createdAt.getTime()) / 60000, 0) / completed.length
    : 0

  const avgService = completed.length > 0
    ? completed.reduce((sum, t) => sum + (t.completedAt!.getTime() - t.startedAt!.getTime()) / 60000, 0) / completed.length
    : 0

  const feedbacks = tokens.flatMap(t => t.feedback ? [t.feedback.rating] : [])
  const avgRating = feedbacks.length > 0 ? feedbacks.reduce((a, b) => a + b, 0) / feedbacks.length : 0

  // Peak hour (8–18)
  const hourBuckets = new Array(24).fill(0)
  tokens.forEach(t => hourBuckets[t.createdAt.getHours()]++)
  let peakH = 8
  for (let h = 8; h <= 18; h++) if (hourBuckets[h] > hourBuckets[peakH]) peakH = h
  const peakHour = `${peakH.toString().padStart(2, '0')}:00`

  // Top services
  const serviceMap = new Map<string, number>()
  tokens.forEach(t => t.serviceTypes.forEach(s => serviceMap.set(s, (serviceMap.get(s) || 0) + 1)))

  // Resolve service codes → titles
  const allServices = await prisma.service.findMany({ select: { code: true, title: true } })
  const serviceTitle = new Map(allServices.map(s => [s.code, s.title]))

  const topServices = Array.from(serviceMap.entries())
    .map(([code, count]) => ({ name: serviceTitle.get(code) || code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Top officers
  const officerTokens = new Map<string, { served: number; ratingSum: number; ratingCount: number }>()
  tokens.forEach(t => {
    if (!t.assignedTo) return
    const ofs = officerTokens.get(t.assignedTo) || { served: 0, ratingSum: 0, ratingCount: 0 }
    if (t.status === 'completed') ofs.served++
    if (t.feedback) { ofs.ratingSum += t.feedback.rating; ofs.ratingCount++ }
    officerTokens.set(t.assignedTo, ofs)
  })

  const officerIds = Array.from(officerTokens.keys())
  const officers = officerIds.length > 0
    ? await prisma.officer.findMany({ where: { id: { in: officerIds } }, select: { id: true, name: true } })
    : []
  const officerName = new Map(officers.map(o => [o.id, o.name]))

  const topOfficers = Array.from(officerTokens.entries())
    .map(([id, stats]) => ({
      name: officerName.get(id) || 'Unknown',
      served: stats.served,
      rating: stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.served - a.served)
    .slice(0, 5)

  return {
    branchName: outlet.name,
    date: label,
    tokensIssued: tokens.length,
    customersServed: completed.length,
    avgWaitMins: Math.round(avgWait * 10) / 10,
    avgServiceMins: Math.round(avgService * 10) / 10,
    avgRating: Math.round(avgRating * 10) / 10,
    peakHour,
    topServices,
    topOfficers,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS builder
// ─────────────────────────────────────────────────────────────────────────────

function buildSummaryPart1SMS(managerName: string, s: BranchSummary): string {
  const nameParts = managerName.trim().split(' ')
  const displayName = nameParts.slice(0, 2).join(' ')
  return [
    `Dear ${displayName},`,
    ``,
    `Daily Summary - ${s.branchName}`,
    `Date: ${s.date}`,
    ``,
    `Tokens Issued    : ${s.tokensIssued}`,
    `Customers Served : ${s.customersServed}`,
    `Avg Wait Time    : ${s.avgWaitMins} mins`,
    `Avg Service Time : ${s.avgServiceMins} mins`,
    `Customer Rating  : ${s.avgRating > 0 ? `${s.avgRating} / 5` : 'N/A'}`,
    ``,
    `SLTMOBITEL`,
  ].join('\n')
}

function buildTopServicesSMS(managerName: string, s: BranchSummary): string | null {
  if (s.topServices.length === 0) return null
  const nameParts = managerName.trim().split(' ')
  const displayName = nameParts.slice(0, 2).join(' ')
  const lines = [
    `Dear ${displayName},`,
    ``,
    `Top Services Today (${s.date}):`,
    ...s.topServices.map((svc, i) => `${i + 1}. ${svc.name} - ${svc.count} customers`),
    ``,
    `SLTMOBITEL`,
  ]
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Email builder
// ─────────────────────────────────────────────────────────────────────────────

function buildSummaryEmailHTML(managerName: string, s: BranchSummary): string {
  const servicesRows = s.topServices.map((svc, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#ffffff'}">
      <td style="padding:10px 14px;">${i + 1}. ${svc.name}</td>
      <td style="padding:10px 14px; text-align:right; font-weight:600; color:#1e40af">${svc.count} customers</td>
    </tr>`).join('')

  const officerRows = s.topOfficers.map((o, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#ffffff'}">
      <td style="padding:10px 14px;">${o.name}</td>
      <td style="padding:10px 14px; text-align:center;">${o.served}</td>
      <td style="padding:10px 14px; text-align:center;">${o.rating > 0 ? `${o.rating} / 5 ⭐` : 'N/A'}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Branch Summary</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#1e293b;">
  <div style="max-width:620px;margin:32px auto;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.12);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e40af 0%,#0056b3 100%);padding:36px 32px;text-align:center;">
      <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;letter-spacing:1px;text-transform:uppercase;">SLTMOBITEL</p>
      <h1 style="margin:8px 0 4px;color:#ffffff;font-size:22px;font-weight:700;">Daily Branch Summary</h1>
      <p style="margin:0;color:rgba(255,255,255,0.8);font-size:14px;">${s.branchName} &nbsp;|&nbsp; ${s.date}</p>
    </div>

    <!-- Greeting -->
    <div style="background:#ffffff;padding:28px 32px 16px;">
      <p style="margin:0 0 8px;font-size:16px;">Dear <strong>${managerName}</strong>,</p>
      <p style="margin:0;color:#64748b;font-size:14px;line-height:1.6;">
        Please find below your daily branch performance summary for
        <strong>${s.branchName}</strong> on <strong>${s.date}</strong>.
      </p>
    </div>

    <!-- Performance Summary -->
    <div style="background:#ffffff;padding:8px 32px 24px;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.8px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
        📊 Performance Summary
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>
          <tr style="background:#f8fafc;">
            <td style="padding:11px 14px;color:#64748b;font-weight:500;">Tokens Issued</td>
            <td style="padding:11px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f172a;">${s.tokensIssued}</td>
          </tr>
          <tr style="background:#ffffff;">
            <td style="padding:11px 14px;color:#64748b;font-weight:500;">Customers Served</td>
            <td style="padding:11px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f172a;">${s.customersServed}</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:11px 14px;color:#64748b;font-weight:500;">Avg Wait Time</td>
            <td style="padding:11px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f172a;">${s.avgWaitMins} mins</td>
          </tr>
          <tr style="background:#ffffff;">
            <td style="padding:11px 14px;color:#64748b;font-weight:500;">Avg Service Time</td>
            <td style="padding:11px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f172a;">${s.avgServiceMins} mins</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:11px 14px;color:#64748b;font-weight:500;">Customer Rating</td>
            <td style="padding:11px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f172a;">${s.avgRating > 0 ? `${s.avgRating} / 5 ⭐` : 'N/A'}</td>
          </tr>
          <tr style="background:#ffffff;">
            <td style="padding:11px 14px;color:#64748b;font-weight:500;">Peak Hour</td>
            <td style="padding:11px 14px;text-align:right;font-weight:700;font-size:15px;color:#0f172a;">${s.peakHour}</td>
          </tr>
        </tbody>
      </table>
    </div>

    ${s.topServices.length > 0 ? `
    <!-- Top Services -->
    <div style="background:#ffffff;padding:8px 32px 24px;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.8px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
        🏷️ Top Services Today
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#e0e7ff;">
            <th style="padding:10px 14px;text-align:left;font-weight:600;color:#3730a3;">Service</th>
            <th style="padding:10px 14px;text-align:right;font-weight:600;color:#3730a3;">Customers</th>
          </tr>
        </thead>
        <tbody>${servicesRows}</tbody>
      </table>
    </div>` : ''}

    ${s.topOfficers.length > 0 ? `
    <!-- Officer Highlights -->
    <div style="background:#ffffff;padding:8px 32px 24px;">
      <h2 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:0.8px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
        👤 Officer Highlights
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#e0e7ff;">
            <th style="padding:10px 14px;text-align:left;font-weight:600;color:#3730a3;">Officer</th>
            <th style="padding:10px 14px;text-align:center;font-weight:600;color:#3730a3;">Served</th>
            <th style="padding:10px 14px;text-align:center;font-weight:600;color:#3730a3;">Rating</th>
          </tr>
        </thead>
        <tbody>${officerRows}</tbody>
      </table>
    </div>` : ''}

    <!-- CTA -->
    <div style="background:#ffffff;padding:8px 32px 28px;text-align:center;">
      <p style="margin:0 0 16px;color:#64748b;font-size:13px;">
        For detailed insights, please log in to the DQMS Portal.
      </p>
      <a href="${process.env.FRONTEND_BASE_URL || 'https://sltsecmanage.slt.lk:7443'}/teleshop-manager/dashboard"
         style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        View Full Dashboard
      </a>
    </div>

    <!-- Footer -->
    <div style="background:#0f172a;padding:20px 32px;text-align:center;">
      <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">SLTMOBITEL</p>
      <p style="margin:0;color:#475569;font-size:11px;">Digital Queue Management System</p>
      <p style="margin:8px 0 0;color:#475569;font-size:10px;">This is an automated daily summary. Please do not reply to this email.</p>
    </div>

  </div>
</body>
</html>`
}

function buildSummaryEmailText(managerName: string, s: BranchSummary): string {
  const lines = [
    `Dear ${managerName},`,
    ``,
    `Please find below your daily branch performance summary for ${s.branchName} on ${s.date}.`,
    ``,
    `PERFORMANCE SUMMARY`,
    `${'─'.repeat(40)}`,
    `Tokens Issued       : ${s.tokensIssued}`,
    `Customers Served    : ${s.customersServed}`,
    `Avg Wait Time       : ${s.avgWaitMins} mins`,
    `Avg Service Time    : ${s.avgServiceMins} mins`,
    `Customer Rating     : ${s.avgRating > 0 ? `${s.avgRating} / 5` : 'N/A'}`,
    `Peak Hour           : ${s.peakHour}`,
    ``,
  ]

  if (s.topServices.length > 0) {
    lines.push(`TOP SERVICES`, `${'─'.repeat(40)}`)
    s.topServices.forEach((svc, i) => lines.push(`${i + 1}. ${svc.name} - ${svc.count} customers`))
    lines.push(``)
  }

  if (s.topOfficers.length > 0) {
    lines.push(`OFFICER HIGHLIGHTS`, `${'─'.repeat(40)}`)
    s.topOfficers.forEach(o => lines.push(`${o.name.padEnd(20)} | Served: ${o.served} | Rating: ${o.rating > 0 ? `${o.rating} / 5` : 'N/A'}`))
    lines.push(``)
  }

  lines.push(
    `For detailed insights, please log in to the DQMS Portal.`,
    ``,
    `Best regards,`,
    `SLTMOBITEL`,
    `Digital Queue Management System`,
  )

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export interface DailySummaryResult {
  managerId: string
  managerName: string
  branchName: string | null
  smsStatus: 'sent' | 'skipped' | 'failed' | 'disabled'
  emailStatus: 'sent' | 'skipped' | 'failed' | 'disabled'
  error?: string
}

export async function sendDailySummaries(): Promise<DailySummaryResult[]> {
  const settings = await getNotificationSettings()
  const smsEnabled = (settings['daily_summary_sms_enabled'] ?? 'false') === 'true'
  const emailEnabled = (settings['daily_summary_email_enabled'] ?? 'false') === 'true'

  console.log(`[DailySummary] SMS enabled: ${smsEnabled}, Email enabled: ${emailEnabled}`)

  const managers = await prisma.teleshopManager.findMany({
    where: { isActive: true, branchId: { not: null } },
    select: { id: true, name: true, mobileNumber: true, email: true, branchId: true },
  })

  const results: DailySummaryResult[] = []

  for (const manager of managers) {
    const result: DailySummaryResult = {
      managerId: manager.id,
      managerName: manager.name,
      branchName: null,
      smsStatus: 'skipped',
      emailStatus: 'skipped',
    }

    try {
      const summary = await buildBranchSummary(manager.branchId!)
      if (!summary) {
        result.error = 'Branch not found'
        results.push(result)
        continue
      }
      result.branchName = summary.branchName

      // SMS
      if (smsEnabled && manager.mobileNumber) {
        try {
          const part1 = buildSummaryPart1SMS(manager.name, summary)
          const smsRes = await sltSmsService.sendSMS({ to: manager.mobileNumber, message: part1 })
          if (smsRes.success) {
            // Send top services as a second SMS if there are any
            const part2 = buildTopServicesSMS(manager.name, summary)
            if (part2) {
              await sltSmsService.sendSMS({ to: manager.mobileNumber, message: part2 })
            }
            result.smsStatus = 'sent'
          } else {
            result.smsStatus = 'failed'
            result.error = smsRes.error
          }
        } catch (err: any) {
          result.smsStatus = 'failed'
          result.error = err.message
        }
      } else if (!smsEnabled) {
        result.smsStatus = 'disabled'
      }

      // Email
      if (emailEnabled && manager.email) {
        try {
          const subject = `Daily Branch Summary \u2013 ${summary.branchName} | ${summary.date}`
          const html = buildSummaryEmailHTML(manager.name, summary)
          const text = buildSummaryEmailText(manager.name, summary)
          const sent = await emailService.sendRawEmail({ to: manager.email, subject, html, text })
          result.emailStatus = sent ? 'sent' : 'failed'
        } catch (err: any) {
          result.emailStatus = 'failed'
          result.error = (result.error ? result.error + '; ' : '') + err.message
        }
      } else if (!emailEnabled) {
        result.emailStatus = 'disabled'
      }

    } catch (err: any) {
      result.error = err.message
    }

    console.log(`[DailySummary] Manager ${manager.name}: SMS=${result.smsStatus} Email=${result.emailStatus}`)
    results.push(result)
  }

  try {
    if (results.length > 0) {
      await upsertNotificationSetting('daily_summary_last_sent', new Date().toISOString())
    }
  } catch (err) {
    console.error('[DailySummary] Failed to save last sent timestamp:', err)
  }

  return results
}
