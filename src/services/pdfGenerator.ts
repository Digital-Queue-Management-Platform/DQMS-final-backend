import PDFDocument from 'pdfkit'
import { Buffer } from 'buffer'

export interface ReportData {
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

/**
 * Generates a beautiful PDF report as a Buffer in-memory.
 */
export const generatePdfReport = async (data: ReportData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true
      })

      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err) => reject(err))

      const marginX = 40
      const contentWidth = 515 // A4 width (595) - 2 * margin (40)
      let currentY = 40

      // Brand Colors
      const primaryColor = '#1e40af' // Navy blue
      const secondaryColor = '#0284c7' // Light blue
      const darkSlate = '#1e293b' // Dark slate for headers
      const textSlate = '#334155' // Medium slate for text
      const borderSlate = '#cbd5e1' // Gray border
      const bgSlate = '#f8fafc' // Off-white card background

      // Helper for Section Headers
      const drawSectionHeader = (title: string, y: number) => {
        // Check page overflow before writing section header
        if (y > 720) {
          doc.addPage()
          y = 40
        }

        doc.fillColor(primaryColor)
        doc.font('Helvetica-Bold')
        doc.fontSize(12)
        doc.text(title, marginX, y)
        
        y += 16
        doc.strokeColor(borderSlate)
        doc.lineWidth(1)
        doc.moveTo(marginX, y).lineTo(marginX + contentWidth, y).stroke()
        
        return y + 10
      }

      // === HEADER ===
      doc.fillColor(primaryColor)
      doc.font('Helvetica-Bold')
      doc.fontSize(20)
      doc.text('SLT MOBITEL', marginX, currentY, { align: 'center' })

      currentY += 24
      doc.fillColor(darkSlate)
      doc.font('Helvetica-Bold')
      doc.fontSize(14)
      doc.text('DIGITAL QUEUE MANAGEMENT PLATFORM', marginX, currentY, { align: 'center' })

      currentY += 18
      doc.fillColor('#6b7280')
      doc.font('Helvetica')
      doc.fontSize(11)
      doc.text('ANALYTICS & PERFORMANCE REPORT', marginX, currentY, { align: 'center' })

      currentY += 16
      doc.fontSize(9)
      doc.text('Insights Intelligence Series | SLT-MOBITEL DQMP Management', marginX, currentY, { align: 'center' })

      currentY += 16
      // Draw double border lines under header
      doc.strokeColor(primaryColor).lineWidth(2).moveTo(marginX, currentY).lineTo(marginX + contentWidth, currentY).stroke()
      currentY += 4
      doc.strokeColor(secondaryColor).lineWidth(1).moveTo(marginX, currentY).lineTo(marginX + contentWidth, currentY).stroke()
      
      currentY += 15

      // === PARAMETERS BLOCK ===
      doc.fillColor(bgSlate)
      doc.rect(marginX, currentY, contentWidth, 54).fill()
      doc.strokeColor(borderSlate).lineWidth(0.5).rect(marginX, currentY, contentWidth, 54).stroke()

      doc.fillColor(darkSlate).font('Helvetica-Bold').fontSize(9)
      doc.text('REPORT PARAMETERS', marginX + 12, currentY + 10)

      doc.fillColor(textSlate).font('Helvetica').fontSize(8.5)
      doc.text(`Period:  ${data.period.startDate} to ${data.period.endDate}`, marginX + 12, currentY + 24)
      doc.text(`Scope:   ${data.scope}`, marginX + 12, currentY + 36)

      const generatedDate = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Colombo',
        dateStyle: 'medium',
        timeStyle: 'short'
      })
      doc.text(`Generated: ${generatedDate} (LKT)`, marginX + 320, currentY + 24)

      currentY += 74

      // === SECTION I. EXECUTIVE SUMMARY ===
      currentY = drawSectionHeader('I. Executive Summary', currentY)

      // Metrics Cards Row
      const cardWidth = (contentWidth - 20) / 3 // 165
      const cardHeight = 50

      const drawMetricCard = (title: string, value: string, x: number, y: number) => {
        doc.fillColor(bgSlate).rect(x, y, cardWidth, cardHeight).fill()
        doc.strokeColor(borderSlate).lineWidth(0.5).rect(x, y, cardWidth, cardHeight).stroke()

        // Card Top Border Accent
        doc.strokeColor(primaryColor).lineWidth(2.5).moveTo(x, y).lineTo(x + cardWidth, y).stroke()

        doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7.5)
        doc.text(title.toUpperCase(), x + 10, y + 10, { width: cardWidth - 20, align: 'center' })

        doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(14)
        doc.text(value, x + 10, y + 25, { width: cardWidth - 20, align: 'center' })
      }

      drawMetricCard('Total Tokens Issued', String(data.executiveSummary.totalTokens), marginX, currentY)
      drawMetricCard('Average Wait Time', `${data.executiveSummary.avgWaitTime} minutes`, marginX + cardWidth + 10, currentY)
      drawMetricCard('Average Service Time', `${data.executiveSummary.avgServiceTime} minutes`, marginX + 2 * cardWidth + 20, currentY)

      currentY += cardHeight + 20

      // === SECTION II. CUSTOMER SATISFACTION ===
      currentY = drawSectionHeader('II. Customer Satisfaction Analysis', currentY)

      const totalFeedbacks = 
        data.customerSatisfaction.fiveStars +
        data.customerSatisfaction.fourStars +
        data.customerSatisfaction.threeStars +
        data.customerSatisfaction.twoStars +
        data.customerSatisfaction.oneStars

      const satisfactionRows = [
        ['5 Stars Excellent', String(data.customerSatisfaction.fiveStars), `${totalFeedbacks > 0 ? ((data.customerSatisfaction.fiveStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%`],
        ['4 Stars Good', String(data.customerSatisfaction.fourStars), `${totalFeedbacks > 0 ? ((data.customerSatisfaction.fourStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%`],
        ['3 Stars Average', String(data.customerSatisfaction.threeStars), `${totalFeedbacks > 0 ? ((data.customerSatisfaction.threeStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%`],
        ['2 Stars Poor', String(data.customerSatisfaction.twoStars), `${totalFeedbacks > 0 ? ((data.customerSatisfaction.twoStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%`],
        ['1 Star Very Poor', String(data.customerSatisfaction.oneStars), `${totalFeedbacks > 0 ? ((data.customerSatisfaction.oneStars / totalFeedbacks) * 100).toFixed(1) : '0.0'}%`]
      ]

      currentY = drawTable(
        doc,
        currentY,
        ['Satisfaction Level', 'Token Count', 'Percentage Share'],
        satisfactionRows,
        [215, 150, 150],
        ['left', 'right', 'right']
      )

      currentY += 20

      // === SECTION III. SERVICE UTILIZATION ===
      currentY = drawSectionHeader('III. Service Utilization Breakdown', currentY)

      const serviceRows = data.serviceUtilization.slice(0, 10).map(s => [
        s.category,
        String(s.tokensIssued)
      ])

      if (serviceRows.length === 0) {
        serviceRows.push(['No service tokens issued in this period', '0'])
      }

      currentY = drawTable(
        doc,
        currentY,
        ['Service Category', 'Tokens Issued'],
        serviceRows,
        [365, 150],
        ['left', 'right']
      )

      currentY += 20

      // === SECTION IV. REGIONAL PERFORMANCE AUDIT ===
      currentY = drawSectionHeader('IV. Regional Performance Audit (Outlets)', currentY)

      const regionalRows = data.regionalPerformance.map(o => [
        o.outletName,
        String(o.tokens),
        `${o.avgWait}m`,
        `${o.avgService}m`,
        `${o.rating} ★`,
        String(o.feedbacks)
      ])

      if (regionalRows.length === 0) {
        regionalRows.push(['No active outlets recorded', '0', '0m', '0m', '0 ★', '0'])
      }

      currentY = drawTable(
        doc,
        currentY,
        ['Outlet Name', 'Tokens', 'Avg Wait', 'Avg Svc', 'Rating', 'Feedbacks'],
        regionalRows,
        [165, 70, 70, 70, 70, 70],
        ['left', 'right', 'right', 'right', 'right', 'right']
      )

      currentY += 20

      // === SECTION V. OFFICER EFFICIENCY INSIGHTS ===
      currentY = drawSectionHeader('V. Officer Efficiency Insights', currentY)

      const officerRows = data.officerEfficiency.slice(0, 15).map(o => [
        o.officerName,
        o.outlet,
        o.status.toUpperCase(),
        String(o.tokens),
        `${o.rating} ★`,
        String(o.feedbacks)
      ])

      if (officerRows.length === 0) {
        officerRows.push(['No active officers recorded', 'N/A', 'OFFLINE', '0', '0 ★', '0'])
      }

      currentY = drawTable(
        doc,
        currentY,
        ['Officer Name', 'Outlet', 'Status', 'Tokens', 'Rating', 'Feedbacks'],
        officerRows,
        [145, 120, 70, 60, 60, 60],
        ['left', 'left', 'center', 'right', 'right', 'right']
      )

      // === PAGE NUMBERS & FOOTER ===
      // bufferPages allows us to add footer to all pages at the end
      const pages = doc.bufferedPageRange()
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i)
        
        doc.strokeColor(borderSlate).lineWidth(0.5).moveTo(marginX, 800).lineTo(marginX + contentWidth, 800).stroke()
        
        doc.fillColor('#94a3b8').font('Helvetica').fontSize(7.5)
        doc.text(
          `SLT-MOBITEL DQMP Analytics Report | Period: ${data.period.startDate} to ${data.period.endDate}`,
          marginX,
          808
        )
        doc.text(
          `Page ${i + 1} of ${pages.count}`,
          marginX + contentWidth - 60,
          808,
          { width: 60, align: 'right' }
        )
      }

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Standard table drawer helper for PDFKit.
 * Handles page breaks, zebra-striping, and columns alignment perfectly.
 */
function drawTable(
  doc: any,
  startY: number,
  headers: string[],
  rows: string[][],
  widths: number[],
  aligns: ('left' | 'right' | 'center')[]
): number {
  let currentY = startY
  const pageHeight = 760
  const marginX = 40
  const rowHeight = 18
  const headerHeight = 22

  const primaryColor = '#1e40af'
  const borderSlate = '#cbd5e1'
  const textSlate = '#334155'
  const bgSlate = '#f8fafc'

  const drawHeaders = (y: number) => {
    // Fill Header BG
    doc.fillColor('#e2e8f0')
    doc.rect(marginX, y, widths.reduce((a, b) => a + b, 0), headerHeight).fill()

    // Header Borders
    doc.strokeColor(borderSlate).lineWidth(0.75)
    doc.rect(marginX, y, widths.reduce((a, b) => a + b, 0), headerHeight).stroke()

    let currentX = marginX
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8)

    headers.forEach((header, i) => {
      doc.text(header, currentX + 6, y + 7, {
        width: widths[i] - 12,
        align: aligns[i]
      })
      currentX += widths[i]
    })
  }

  // Draw header initially
  drawHeaders(currentY)
  currentY += headerHeight

  // Draw rows
  rows.forEach((row, rowIndex) => {
    // Check if we need to wrap to the next page
    if (currentY + rowHeight > pageHeight) {
      doc.addPage()
      currentY = 40 // Reset to top of new page
      drawHeaders(currentY)
      currentY += headerHeight
    }

    // Zebra striping background
    if (rowIndex % 2 === 1) {
      doc.fillColor(bgSlate)
      doc.rect(marginX, currentY, widths.reduce((a, b) => a + b, 0), rowHeight).fill()
    }

    // Grid border
    doc.strokeColor('#f1f5f9').lineWidth(0.5)
    doc.rect(marginX, currentY, widths.reduce((a, b) => a + b, 0), rowHeight).stroke()

    // Draw outer boundary lines slightly darker
    doc.strokeColor('#e2e8f0').lineWidth(0.5)
    doc.moveTo(marginX, currentY + rowHeight).lineTo(marginX + widths.reduce((a, b) => a + b, 0), currentY + rowHeight).stroke()

    let currentX = marginX
    doc.fillColor(textSlate).font('Helvetica').fontSize(7.5)

    row.forEach((cell, cellIndex) => {
      // Color coded active status
      if (cellIndex === 2 && (cell === 'AVAILABLE' || cell === 'ONLINE' || cell === 'OFFLINE' || cell === 'SERVING')) {
        if (cell === 'AVAILABLE' || cell === 'ONLINE' || cell === 'SERVING') {
          doc.fillColor('#059669').font('Helvetica-Bold') // Green
        } else {
          doc.fillColor('#dc2626').font('Helvetica') // Red
        }
      } else {
        doc.fillColor(textSlate).font('Helvetica')
      }

      doc.text(cell, currentX + 6, currentY + 5, {
        width: widths[cellIndex] - 12,
        align: aligns[cellIndex]
      })
      currentX += widths[cellIndex]
    })

    currentY += rowHeight
  })

  return currentY
}
