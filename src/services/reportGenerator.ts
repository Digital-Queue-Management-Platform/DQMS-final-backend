import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface ReportData {
  period: {
    startDate: string
    endDate: string
  }
  scope: string
  executiveSummary: {
    totalTokens: number
    avgWaitTime: number
    avgServiceTime: number
  }
  customerSatisfaction: {
    fiveStars: number
    fourStars: number
    threeStars: number
    twoStars: number
    oneStars: number
  }
  serviceUtilization: Array<{
    category: string
    tokensIssued: number
  }>
  regionalPerformance: Array<{
    outletName: string
    tokens: number
    avgWait: number
    avgService: number
    rating: number
    feedbacks: number
  }>
  officerEfficiency: Array<{
    officerName: string
    outlet: string
    status: string
    tokens: number
    rating: number
    feedbacks: number
  }>
}

export const generateAnalyticsReport = async (
  startDate: Date, 
  endDate: Date, 
  scope: string = "Island-wide (All Outlets)"
): Promise<ReportData> => {
  
  // Get all tokens in the date range
  const tokens = await prisma.token.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    },
    include: {
      outlet: {
        select: {
          id: true,
          name: true
        }
      },
      officer: {
        select: {
          id: true,
          name: true
        }
      },
      feedback: true
    }
  })

  // Calculate executive summary
  const totalTokens = tokens.length
  
  const completedTokens = tokens.filter(t => t.completedAt)
  const avgWaitTime = completedTokens.length > 0 
    ? Math.round(
        completedTokens.reduce((sum, token) => {
          if (token.calledAt && token.createdAt) {
            return sum + (new Date(token.calledAt).getTime() - new Date(token.createdAt).getTime()) / (1000 * 60)
          }
          return sum
        }, 0) / completedTokens.length * 10
      ) / 10
    : 0

  const avgServiceTime = completedTokens.length > 0
    ? Math.round(
        completedTokens.reduce((sum, token) => {
          if (token.completedAt && token.startedAt) {
            return sum + (new Date(token.completedAt).getTime() - new Date(token.startedAt).getTime()) / (1000 * 60)
          }
          return sum
        }, 0) / completedTokens.length * 10
      ) / 10
    : 0

  // Calculate customer satisfaction
  const feedbacks = tokens.map(t => t.feedback).filter(Boolean)
  const satisfactionCounts = {
    fiveStars: feedbacks.filter(f => f?.rating === 5).length,
    fourStars: feedbacks.filter(f => f?.rating === 4).length,
    threeStars: feedbacks.filter(f => f?.rating === 3).length,
    twoStars: feedbacks.filter(f => f?.rating === 2).length,
    oneStars: feedbacks.filter(f => f?.rating === 1).length
  }

  // Calculate service utilization
  const serviceCategories = new Map<string, number>()
  tokens.forEach(token => {
    // Use the serviceTypes array from the token
    if (token.serviceTypes && token.serviceTypes.length > 0) {
      token.serviceTypes.forEach(serviceType => {
        serviceCategories.set(serviceType, (serviceCategories.get(serviceType) || 0) + 1)
      })
    } else {
      serviceCategories.set('Other', (serviceCategories.get('Other') || 0) + 1)
    }
  })
  
  const serviceUtilization = Array.from(serviceCategories.entries())
    .map(([category, tokensIssued]) => ({ category, tokensIssued }))
    .sort((a, b) => b.tokensIssued - a.tokensIssued)

  // Calculate regional performance
  const outletStats = new Map()
  tokens.forEach(token => {
    if (!token.outlet) return
    
    const key = token.outlet.id
    if (!outletStats.has(key)) {
      outletStats.set(key, {
        outletName: token.outlet.name,
        tokens: 0,
        totalWaitTime: 0,
        totalServiceTime: 0,
        totalRating: 0,
        feedbackCount: 0,
        completedTokens: 0
      })
    }
    
    const stats = outletStats.get(key)
    stats.tokens++
    
    if (token.completedAt && token.calledAt && token.createdAt) {
      stats.completedTokens++
      stats.totalWaitTime += (new Date(token.calledAt).getTime() - new Date(token.createdAt).getTime()) / (1000 * 60)
    }
    
    if (token.completedAt && token.startedAt) {
      stats.totalServiceTime += (new Date(token.completedAt).getTime() - new Date(token.startedAt).getTime()) / (1000 * 60)
    }
    
    if (token.feedback) {
      stats.totalRating += token.feedback.rating
      stats.feedbackCount++
    }
  })

  const regionalPerformance = Array.from(outletStats.values()).map(stats => ({
    outletName: stats.outletName,
    tokens: stats.tokens,
    avgWait: stats.completedTokens > 0 ? Math.round(stats.totalWaitTime / stats.completedTokens * 10) / 10 : 0,
    avgService: stats.completedTokens > 0 ? Math.round(stats.totalServiceTime / stats.completedTokens * 10) / 10 : 0,
    rating: stats.feedbackCount > 0 ? Math.round(stats.totalRating / stats.feedbackCount * 10) / 10 : 0,
    feedbacks: stats.feedbackCount
  }))

  // Calculate officer efficiency - get ALL officers in the system
  // First, get all officers from the database
  const allOfficers = await prisma.officer.findMany({
    include: {
      outlet: {
        select: {
          id: true,
          name: true
        }
      }
    }
  })

  // Create a map with all officers
  const officerStats = new Map()
  
  // Initialize all officers with zero stats
  allOfficers.forEach(officer => {
    officerStats.set(officer.id, {
      officerName: officer.name,
      outlet: officer.outlet?.name || 'No Outlet Assigned',
      status: officer.status, // 'available', 'online', 'offline'
      tokens: 0,
      totalRating: 0,
      feedbackCount: 0
    })
  })

  // Now update stats for officers who served tokens in the date range
  tokens.forEach(token => {
    if (!token.officer) return
    
    const key = token.officer.id
    if (officerStats.has(key)) {
      const stats = officerStats.get(key)
      stats.tokens++
      
      if (token.feedback) {
        stats.totalRating += token.feedback.rating
        stats.feedbackCount++
      }
    }
  })

  const officerEfficiency = Array.from(officerStats.values())
    .map(stats => ({
      officerName: stats.officerName,
      outlet: stats.outlet,
      status: stats.status,
      tokens: stats.tokens,
      rating: stats.feedbackCount > 0 ? Math.round(stats.totalRating / stats.feedbackCount * 10) / 10 : 0,
      feedbacks: stats.feedbackCount
    }))
    .sort((a, b) => {
      // Sort by status (active first), then by tokens served
      if (a.status !== b.status) {
        const statusOrder: { [key: string]: number } = { 'available': 0, 'online': 1, 'offline': 2 }
        return (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3)
      }
      return b.tokens - a.tokens
    })

  return {
    period: {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    },
    scope,
    executiveSummary: {
      totalTokens,
      avgWaitTime,
      avgServiceTime
    },
    customerSatisfaction: satisfactionCounts,
    serviceUtilization,
    regionalPerformance,
    officerEfficiency
  }
}

export const generateReportHTML = (data: ReportData): string => {
  const reportId = `DQMP-${Date.now()}`
  const generatedDate = new Date().toLocaleString('en-US', { 
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: 'numeric', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })

  const totalFeedbacks = Object.values(data.customerSatisfaction).reduce((sum, count) => sum + count, 0)

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>DQMP Analytics Report</title>
    <style>
        @page {
            size: A4;
            margin: 1cm;
        }
        @media print {
            thead { display: table-header-group !important; }
            tbody { display: table-row-group !important; }
            tr { display: table-row !important; page-break-inside: avoid; }
            th, td { display: table-cell !important; }
            table { page-break-inside: auto; }
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.4;
            margin: 0;
            padding: 0;
            font-size: 11px;
            color: #333;
        }
        .header {
            text-align: center;
            border-bottom: 3px solid #1e40af;
            padding-bottom: 15px;
            margin-bottom: 20px;
        }
        .header h1 {
            font-size: 18px;
            margin: 0;
            color: #1e40af;
            font-weight: bold;
        }
        .header h2 {
            font-size: 14px;
            margin: 5px 0;
            color: #374151;
            font-weight: normal;
        }
        .header h3 {
            font-size: 12px;
            margin: 5px 0;
            color: #6b7280;
            font-weight: normal;
        }
        .section {
            margin-bottom: 20px;
            page-break-inside: avoid;
        }
        .section-title {
            font-size: 12px;
            font-weight: bold;
            color: #1e40af;
            margin-bottom: 8px;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 3px;
        }
        .parameters {
            background: #f8fafc;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 15px;
        }
        .parameters h4 {
            margin: 0 0 8px 0;
            font-size: 11px;
            font-weight: bold;
            color: #374151;
        }
        .param-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 2px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
            font-size: 10px;
        }
        caption {
            caption-side: top;
            text-align: left;
            font-weight: bold;
            margin-bottom: 8px;
            color: #374151;
            font-size: 11px;
            padding: 4px 0;
        }
        th, td {
            padding: 8px;
            text-align: left;
            border: 1px solid #d1d5db;
            vertical-align: top;
        }
        th {
            background-color: #f3f4f6 !important;
            font-weight: bold !important;
            color: #111827 !important;
            font-size: 10px !important;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border: 2px solid #9ca3af !important;
            border-bottom: 3px solid #6b7280 !important;
            padding: 10px 8px !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        td {
            color: #374151;
            font-size: 10px;
        }
        thead {
            display: table-header-group !important;
        }
        tbody {
            display: table-row-group !important;
        }
        tr {
            display: table-row !important;
        }
        th, td {
            display: table-cell !important;
        }
        tbody {
            display: table-row-group;
        }
        .number {
            text-align: right;
        }
        .footer {
            position: fixed;
            bottom: 0.5cm;
            left: 0;
            right: 0;
            text-align: center;
            font-size: 9px;
            color: #6b7280;
            border-top: 1px solid #e5e7eb;
            padding-top: 5px;
        }
        .page-break {
            page-break-before: always;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>SLT MOBITEL</h1>
        <h2>DIGITAL QUEUE MANAGEMENT PLATFORM</h2>
        <h3>ANALYTICS & PERFORMANCE</h3>
        <h3>Insights Intelligence Series</h3>
    </div>

    <div class="parameters">
        <h4>REPORT PARAMETERS</h4>
        <div class="param-row">
            <span>Period:</span>
            <span>${data.period.startDate} to ${data.period.endDate}</span>
        </div>
        <div class="param-row">
            <span>Scope:</span>
            <span>${data.scope}</span>
        </div>
    </div>

    <div class="section">
        <div class="section-title">I. Executive Summary</div>
        <table>
            <thead style="display: table-header-group; background-color: #f3f4f6;">
                <tr style="background-color: #f3f4f6;">
                    <th style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Operational Metric</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Statistical Value</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Total Tokens Issued</td>
                    <td class="number">${data.executiveSummary.totalTokens}</td>
                </tr>
                <tr>
                    <td>Average Wait Time</td>
                    <td class="number">${data.executiveSummary.avgWaitTime} minutes</td>
                </tr>
                <tr>
                    <td>Average Service Time</td>
                    <td class="number">${data.executiveSummary.avgServiceTime} minutes</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">II. Customer Satisfaction Analysis</div>
        <table>
            <thead style="display: table-header-group; background-color: #f3f4f6;">
                <tr style="background-color: #f3f4f6;">
                    <th style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Satisfaction Level</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Token Count</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Percentage Share</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>5 Stars</td>
                    <td class="number">${data.customerSatisfaction.fiveStars}</td>
                    <td class="number">${totalFeedbacks > 0 ? ((data.customerSatisfaction.fiveStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
                <tr>
                    <td>4 Stars</td>
                    <td class="number">${data.customerSatisfaction.fourStars}</td>
                    <td class="number">${totalFeedbacks > 0 ? ((data.customerSatisfaction.fourStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
                <tr>
                    <td>3 Stars</td>
                    <td class="number">${data.customerSatisfaction.threeStars}</td>
                    <td class="number">${totalFeedbacks > 0 ? ((data.customerSatisfaction.threeStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
                <tr>
                    <td>2 Stars</td>
                    <td class="number">${data.customerSatisfaction.twoStars}</td>
                    <td class="number">${totalFeedbacks > 0 ? ((data.customerSatisfaction.twoStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
                <tr>
                    <td>1 Stars</td>
                    <td class="number">${data.customerSatisfaction.oneStars}</td>
                    <td class="number">${totalFeedbacks > 0 ? ((data.customerSatisfaction.oneStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">III. Service Utilization Breakdown</div>
        <table>
            <thead style="display: table-header-group; background-color: #f3f4f6;">
                <tr style="background-color: #f3f4f6;">
                    <th style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Service Category</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Tokens Issued</th>
                </tr>
            </thead>
            <tbody>
                ${data.serviceUtilization.map(service => 
                  `<tr>
                    <td>${service.category}</td>
                    <td class="number">${service.tokensIssued}</td>
                  </tr>`
                ).join('')}
            </tbody>
        </table>
    </div>

    <div class="section" style="page-break-before: always;">
        <div class="section-title">IV. Regional Performance Audit</div>
        <table>
            <thead style="display: table-header-group; background-color: #f3f4f6;">
                <tr style="background-color: #f3f4f6;">
                    <th style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Outlet Name</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Tokens</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Avg Wait</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Avg Svc</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Rating</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Feedbacks</th>
                </tr>
            </thead>
            <tbody>
                ${data.regionalPerformance.map(outlet => 
                  `<tr>
                    <td>${outlet.outletName}</td>
                    <td class="number">${outlet.tokens}</td>
                    <td class="number">${outlet.avgWait}m</td>
                    <td class="number">${outlet.avgService}m</td>
                    <td class="number">${outlet.rating}</td>
                    <td class="number">${outlet.feedbacks}</td>
                  </tr>`
                ).join('')}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">V. Officer Efficiency Insights</div>
        <table>
            <thead style="display: table-header-group; background-color: #f3f4f6;">
                <tr style="background-color: #f3f4f6;">
                    <th style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Officer Name</th>
                    <th style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Outlet</th>
                    <th style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Status</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Tokens</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Rating</th>
                    <th class="number" style="background-color: #f3f4f6; font-weight: bold; color: #111827; padding: 10px 8px; border: 2px solid #9ca3af;">Feedbacks</th>
                </tr>
            </thead>
            <tbody>
                ${data.officerEfficiency.map(officer => 
                  `<tr>
                    <td>${officer.officerName}</td>
                    <td>${officer.outlet}</td>
                    <td><span style="color: ${officer.status === 'offline' ? '#dc2626' : officer.status === 'available' ? '#059669' : '#2563eb'}; font-weight: bold;">${officer.status.toUpperCase()}</span></td>
                    <td class="number">${officer.tokens}</td>
                    <td class="number">${officer.rating}</td>
                    <td class="number">${officer.feedbacks}</td>
                  </tr>`
                ).join('')}
            </tbody>
        </table>
    </div>

    <div class="footer">
        ${reportId} | Generated on: ${generatedDate} | SLT-MOBITEL DQMP Management Report
    </div>
</body>
</html>
  `
}