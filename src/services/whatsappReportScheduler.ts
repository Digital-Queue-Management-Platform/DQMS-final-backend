import { generateAnalyticsReport } from './reportGenerator'
import { generatePdfReport } from './pdfGenerator'
import { whatsappService } from './whatsappService'
import { systemLogger } from './systemLogger'

// Helper: Get next scheduled report date
export function getNextWhatsAppReportTime(now: Date = new Date()): Date {
  const reportHour = Number(process.env.WHATSAPP_REPORT_HOUR ?? 19) // Default: 7:00 PM
  const reportMinute = Number(process.env.WHATSAPP_REPORT_MINUTE ?? 0)

  const next = new Date(now)
  next.setHours(reportHour, reportMinute, 0, 0)

  // If current time is past today's scheduled time, schedule for tomorrow
  if (now.getTime() >= next.getTime()) {
    next.setDate(next.getDate() + 1)
  }

  // Skip Sundays (0 = Sunday)
  // If next is Sunday, push to Monday
  if (next.getDay() === 0) {
    next.setDate(next.getDate() + 1)
  }

  return next
}

/**
 * Compiles report data, generates the PDF, and dispatches it via WhatsApp.
 * Can be called automatically by scheduler or manually via API.
 */
export async function triggerDailyReport(startDate: Date, endDate: Date, scope: string = 'Island-wide (All Outlets)'): Promise<{ success: boolean; message: string; filename?: string }> {
  try {
    systemLogger.info(`Starting automated daily report compilation`, {
      service: 'backend',
      module: 'whatsapp-scheduler',
      event: 'compilation-started',
      metadata: { startDate: startDate.toISOString(), endDate: endDate.toISOString(), scope }
    })

    // 1. Fetch metrics from DB using standard generator
    const reportData = await generateAnalyticsReport(startDate, endDate, scope)

    if (!reportData) {
      throw new Error("Analytics report generation returned empty data.")
    }

    // 2. Generate PDF using pdfkit
    const pdfBuffer = await generatePdfReport(reportData)

    // 3. Draft beautiful WhatsApp caption text
    const dateFormatted = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })

    const caption = 
`📊 *SLT-MOBITEL DQMP DAILY INSIGHTS* 📊
*Date:* ${dateFormatted}
*Scope:* ${scope}

Dear Management Team,

Here is the automated daily performance and operations summary for the Digital Queue Management Platform.

📈 *Key Highlights:*
• *Total Tokens Issued:* ${reportData.executiveSummary.totalTokens}
• *Avg Wait Time:* ${reportData.executiveSummary.avgWaitTime} minutes
• *Avg Service Time:* ${reportData.executiveSummary.avgServiceTime} minutes

🗂️ _A detailed PDF performance audit, including outlet-wise metrics and officer efficiencies, is attached below._

_SLT-MOBITEL DQMP Insights Intelligence Series_`

    // 4. Send report to WhatsApp Group
    const filename = `DQMP-Daily-Insights-${reportData.period.startDate}.pdf`
    const isSent = await whatsappService.sendInsightsReport(pdfBuffer, filename, caption)

    if (isSent) {
      systemLogger.info('Daily insights report successfully dispatched to WhatsApp group', {
        service: 'backend',
        module: 'whatsapp-scheduler',
        event: 'dispatch-success',
        metadata: { filename }
      })
      return { success: true, message: 'Insights report successfully dispatched.', filename }
    } else {
      throw new Error('WhatsApp service failed to send report.')
    }
  } catch (error: any) {
    systemLogger.error('Daily insights report automation failed', {
      service: 'backend',
      module: 'whatsapp-scheduler',
      event: 'automation-failed',
      metadata: { error: error.message },
      stackTrace: error.stack
    })
    console.error('Report automation error:', error)
    return { success: false, message: `Report automation error: ${error.message}` }
  }
}

/**
 * Orchestrates the recurring daily report ticks.
 */
let schedulerTimeout: NodeJS.Timeout | null = null

export function startWhatsAppReportScheduler() {
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout)
  }

  const next = getNextWhatsAppReportTime()
  const msRemaining = Math.max(0, next.getTime() - Date.now())
  
  const minutes = (msRemaining / 1000 / 60).toFixed(1)
  console.log(`⏰ WhatsApp Report Scheduler: Next automated run scheduled at ${next.toLocaleString()} (in ${minutes} minutes)`)

  systemLogger.info(`WhatsApp Report Scheduler successfully initialized`, {
    service: 'backend',
    module: 'whatsapp-scheduler',
    event: 'scheduler-initialized',
    metadata: { nextRunTime: next.toISOString(), minutesRemaining: Number(minutes) }
  })

  schedulerTimeout = setTimeout(async () => {
    try {
      const today = new Date()
      // Double check that we don't run on Sunday (0)
      if (today.getDay() !== 0) {
        console.log(`⏰ WhatsApp Report Scheduler: Executing daily report dispatch at ${today.toLocaleString()}`)
        
        // Define today's time range
        const start = new Date(today)
        start.setHours(0, 0, 0, 0)
        
        const end = new Date(today)
        end.setHours(23, 59, 59, 999)

        await triggerDailyReport(start, end)
      } else {
        console.log(`⏰ WhatsApp Report Scheduler: Sunday detected, skipping execution.`)
      }
    } catch (err: any) {
      console.error('WhatsApp Report Scheduler tick execution error:', err)
    } finally {
      // Always reschedule the next tick
      startWhatsAppReportScheduler()
    }
  }, msRemaining)
}
