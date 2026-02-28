import 'dotenv/config'
import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { WebSocketServer } from "ws"
import { createServer } from "http"
import { PrismaClient } from "@prisma/client"
import compression from "compression"
import pino from "pino"
import { getNextDailyReset, getLastDailyReset } from "./utils/resetWindow"

// Import routes
import customerRoutes from "./routes/customer.routes"
import officerRoutes from "./routes/officer.routes"
import adminRoutes from "./routes/admin.routes"
import queueRoutes from "./routes/queue.routes"
import feedbackRoutes from "./routes/feedback.routes"
import documentRoutes from "./routes/document.routes"
import managerRoutes from "./routes/manager.routes"
import teleshopManagerRoutes from "./routes/teleshop-manager.routes"
import appointmentRoutes from "./routes/appointment.routes"
import ipSpeakerRoutes from "./routes/ip-speaker.routes"
import twilioRoutes from "./routes/twilio.routes"
import serviceCaseRoutes from "./routes/service-case.routes"
import gmRoutes from "./routes/gm.routes"
import dgmRoutes from "./routes/dgm.routes"
import kioskRoutes from "./routes/kiosk.routes"
import billRoutes from "./routes/bill.routes"

export const prisma = new PrismaClient()
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

// Middleware
// CORS: allow multiple origins (comma-separated in FRONTEND_ORIGIN) and enable credentials
const frontendOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((s) => s.trim())

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (frontendOrigins.includes(origin)) return callback(null, true)
      return callback(new Error("CORS not allowed"))
    },
    credentials: true,
  })
)
app.use(compression({ threshold: Number(process.env.COMPRESS_THRESHOLD || 1024) }))
app.use(cookieParser())
app.use(express.json())
app.use("/uploads", express.static("uploads"))

// Performance instrumentation & aggregation
const perfLogThreshold = Number(process.env.PERF_LOG_THRESHOLD_MS || 200)
interface MetricStats { count: number; total: number; max: number; samples: number[] }
const routeMetrics = new Map<string, MetricStats>()
function recordMetric(key: string, dur: number) {
  let stats = routeMetrics.get(key)
  if (!stats) { stats = { count: 0, total: 0, max: 0, samples: [] }; routeMetrics.set(key, stats) }
  stats.count++; stats.total += dur; if (dur > stats.max) stats.max = dur
  if (stats.samples.length < 50) {
    stats.samples.push(dur)
  } else {
    const idx = Math.floor(Math.random() * stats.samples.length)
    stats.samples[idx] = dur
  }
}
if (process.env.PERF_LOG !== "false") {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint()
    res.once("finish", () => {
      const durMs = Number(process.hrtime.bigint() - start) / 1e6
      const keyBase = req.route?.path || req.originalUrl.split('?')[0]
      recordMetric(`${req.method} ${keyBase}`, durMs)
      if (durMs >= perfLogThreshold) {
        logger.warn({ durMs: Number(durMs.toFixed(1)), method: req.method, url: req.originalUrl }, 'slow_request')
      }
    })
    next()
  })
}

// WebSocket for real-time updates
wss.on("connection", (ws) => {
  console.log("Client connected")

  ws.on("message", (message) => {
    console.log("Received:", message.toString())
  })

  ws.on("close", () => {
    console.log("Client disconnected")
  })
})

// Broadcast function for real-time updates
export const broadcast = (data: any) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      // OPEN
      client.send(JSON.stringify(data))
    }
  })
}

// Routes
app.use("/api/customer", customerRoutes)
app.use("/api/officer", officerRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/queue", queueRoutes)
app.use("/api/feedback", feedbackRoutes)
app.use("/api/document", documentRoutes)
app.use("/api/manager", managerRoutes)
app.use("/api/teleshop-manager", teleshopManagerRoutes)
app.use("/api/ip-speaker", ipSpeakerRoutes)
app.use("/api/appointment", appointmentRoutes)
app.use("/api/twilio", twilioRoutes)
app.use("/api/service-case", serviceCaseRoutes)
app.use("/api/kiosk", kioskRoutes)
app.use("/api/bills", billRoutes)
app.use("/api/gm", gmRoutes)
app.use("/api/dgm", dgmRoutes)

// Public: Branch closed status check (no auth required)
// Checks: Saturday ≥ 12:30 PM | mercantile holiday | active closure notice
app.get("/api/branch-status/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params
    const atParam = req.query.at
    const now = atParam ? new Date(atParam as string) : new Date()
    if (isNaN(now.getTime())) {
      return res.status(400).json({ error: "Invalid 'at' date provided" })
    }

    // 1. Saturday after 12:30 PM rule (day 6 = Saturday)
    const dayOfWeek = now.getDay()
    const hours = now.getHours()
    const minutes = now.getMinutes()
    if (dayOfWeek === 6 && (hours > 12 || (hours === 12 && minutes >= 30))) {
      return res.json({
        isClosed: true,
        reason: "Branch closes on Saturdays after 12:30 PM",
        activeNotice: null
      })
    }

    // 2. Mercantile holiday check
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(now)
    todayEnd.setHours(23, 59, 59, 999)

    const holidays = await (prisma as any).mercantileHoliday.findMany()
    for (const holiday of holidays) {
      const hDate = new Date(holiday.date)
      if (holiday.isRecurring) {
        // Match month and day only, any year
        if (hDate.getMonth() === now.getMonth() && hDate.getDate() === now.getDate()) {
          return res.json({
            isClosed: true,
            reason: `Mercantile Holiday: ${holiday.name}`,
            activeNotice: null
          })
        }
      } else {
        // Exact date match
        if (hDate >= todayStart && hDate <= todayEnd) {
          return res.json({
            isClosed: true,
            reason: `Mercantile Holiday: ${holiday.name}`,
            activeNotice: null
          })
        }
      }
    }

    // 3. Active closure notice for this outlet
    const activeNotice = await (prisma as any).closureNotice.findFirst({
      where: {
        outletId,
        startsAt: { lte: now },
        endsAt: { gte: now }
      },
      orderBy: { createdAt: 'desc' }
    })

    if (activeNotice) {
      return res.json({
        isClosed: true,
        reason: activeNotice.title,
        activeNotice: {
          title: activeNotice.title,
          message: activeNotice.message
        }
      })
    }

    res.set('Cache-Control', 'no-store')
    res.json({ isClosed: false, reason: null, activeNotice: null })
  } catch (err) {
    logger.error({ err }, "Branch-status check error")
    res.status(500).json({ error: "Failed to check branch status" })
  }
})

// Health check
app.get("/api/health", (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

app.get('/api/metrics', (req, res) => {
  const out: any = {}
  for (const [key, stats] of routeMetrics.entries()) {
    const avg = stats.total / stats.count
    const sorted = [...stats.samples].sort((a, b) => a - b)
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0
    out[key] = { count: stats.count, avg: Number(avg.toFixed(2)), max: Number(stats.max.toFixed(2)), p95: Number(p95.toFixed(2)) }
  }
  res.set('Cache-Control', 'no-store')
  res.json({ generatedAt: new Date().toISOString(), routes: out })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
})

// Periodic job: detect long-wait tokens and create alerts
const LONG_WAIT_MINUTES = Number(process.env.LONG_WAIT_MINUTES || 10)
// In production, reduce frequency to ease DB connection pressure
const LONG_WAIT_CHECK_MS = process.env.NODE_ENV === "production" ? 1000 * 60 * 5 : 1000 * 60

const checkLongWait = async () => {
  try {
    const cutoff = new Date(Date.now() - LONG_WAIT_MINUTES * 60 * 1000)
    const tokens = await prisma.token.findMany({
      where: {
        status: "waiting",
        createdAt: { lt: cutoff },
      },
      include: { outlet: true, customer: true },
    })
    if (tokens.length === 0) return

    // Fetch existing alerts for these tokens in one query
    const tokenIds = tokens.map(t => t.id)
    const existingAlerts = await prisma.alert.findMany({
      where: { type: "long_wait", relatedEntity: { in: tokenIds } },
      select: { relatedEntity: true }
    })
    const existingSet = new Set(existingAlerts.map(a => a.relatedEntity))

    for (const token of tokens) {
      if (existingSet.has(token.id)) continue
      const message = `Token #${token.tokenNumber} has been waiting more than ${LONG_WAIT_MINUTES} minutes at ${token.outlet.name}`
      const alert = await prisma.alert.create({
        data: { type: "long_wait", severity: "medium", message, relatedEntity: token.id },
      })
      broadcast({ type: "LONG_WAIT", data: { alert, token } })
    }
  } catch (err) {
    logger.error({ err }, "Long-wait check error")
  }
}

// Allow disabling the job via env if needed (e.g., multi-instance deployments)
if (process.env.DISABLE_LONG_WAIT_JOB !== "true") {
  setInterval(checkLongWait, LONG_WAIT_CHECK_MS)
}

// Officer presence monitoring - REMOVED automatic timeout system
// Officers should only go offline when they explicitly logout or close browser window
// The timeout-based presence detection has been disabled as requested

// Auto-enqueue upcoming appointments
const APPOINTMENT_ENQUEUE_AHEAD_MIN = Number(process.env.APPOINTMENT_ENQUEUE_AHEAD_MIN || 15) // minutes before slot
const APPOINTMENT_POLL_MS = 60 * 1000

async function processAppointments() {
  try {
    const now = new Date()
    const ahead = new Date(now.getTime() + APPOINTMENT_ENQUEUE_AHEAD_MIN * 60 * 1000)

    // Fetch due appointments (booked, today, appointmentAt <= ahead)
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)

    const dueAppointments: any = await prisma.$queryRaw`
      SELECT * FROM "Appointment"
      WHERE "status" = 'booked'
        AND "appointmentAt" >= ${startOfDay}
        AND "appointmentAt" <= ${ahead}
      ORDER BY "appointmentAt" ASC
    `

    for (const appt of dueAppointments as any[]) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          // Skip if already queued
          const apptRows = await (tx as any).$queryRaw`SELECT * FROM "Appointment" WHERE "id" = ${appt.id} FOR UPDATE`
          const apptRow: any = Array.isArray(apptRows) ? apptRows[0] : null
          if (!apptRow || apptRow.status !== 'booked') return

          // Check existing active token today
          const lastReset = getLastDailyReset()
          const existingToken: any = await tx.token.findFirst({
            where: {
              outletId: apptRow.outletId,
              status: { in: ["waiting", "in_service"] },
              createdAt: { gte: lastReset },
              customer: { mobileNumber: apptRow.mobileNumber }
            },
            include: { customer: true }
          })

          let tokenId = existingToken?.id
          let createdTokenId: string | null = null
          if (!existingToken) {
            // Ensure customer exists
            let customer = await tx.customer.findFirst({ where: { mobileNumber: apptRow.mobileNumber } })
            if (!customer) {
              customer = await tx.customer.create({ data: { name: apptRow.name, mobileNumber: apptRow.mobileNumber } })
            }

            // Next token number for outlet today
            const lastToken = await tx.token.findFirst({
              where: { outletId: apptRow.outletId, createdAt: { gte: lastReset } },
              orderBy: { tokenNumber: 'desc' },
              select: { tokenNumber: true }
            })
            const tokenNumber = (lastToken?.tokenNumber || 0) + 1

            const newToken = await tx.token.create({
              data: {
                tokenNumber,
                customerId: customer.id,
                serviceTypes: apptRow.serviceTypes,
                outletId: apptRow.outletId,
                status: 'waiting',
                preferredLanguages: apptRow.preferredLanguage ? [apptRow.preferredLanguage] : undefined,
              }
            })
            tokenId = newToken.id
            createdTokenId = newToken.id
          }

          // Update appointment to queued
          await tx.$executeRaw`
            UPDATE "Appointment"
            SET "status" = 'queued', "queuedAt" = now(), "tokenId" = ${tokenId}
            WHERE "id" = ${apptRow.id}
          `

          return { createdTokenId, outletId: apptRow.outletId }
        }, { timeout: 10000 })

        if (result?.createdTokenId) {
          // Notify clients so officer queue refreshes automatically
          broadcast({ type: 'NEW_TOKEN', data: { tokenId: result.createdTokenId, outletId: result.outletId } })
        }
      } catch (e) {
        logger.error({ err: e, appointmentId: appt?.id }, 'Failed to enqueue appointment')
      }
    }
  } catch (err) {
    logger.error({ err }, 'Appointment processing error')
  }
}

if (process.env.DISABLE_APPOINTMENT_JOB !== 'true') {
  setInterval(processAppointments, APPOINTMENT_POLL_MS)
}

// Daily reset signal: broadcast an event exactly at the configured reset time
function scheduleDailyResetTick() {
  const next = getNextDailyReset()
  const ms = Math.max(0, next.getTime() - Date.now())
  logger.info(`Next daily reset at ${next.toLocaleString()} (in ${(ms / 1000 / 60).toFixed(1)} minutes)`)
  setTimeout(async () => {
    try {
      const ts = new Date()
      logger.info(`Daily reset boundary reached: ${ts.toLocaleString()}`)

      // Reset all officer counter assignments
      await prisma.officer.updateMany({
        where: {
          counterNumber: { not: null }
        },
        data: {
          counterNumber: null
        }
      })
      logger.info('All officer counter assignments reset')

      // Broadcast a lightweight signal; clients may optionally refresh views
      broadcast({ type: "DAILY_RESET", data: { timestamp: ts.toISOString() } })
    } catch (e) {
      logger.error({ err: e }, "Error during daily reset")
    } finally {
      // Schedule the next tick
      scheduleDailyResetTick()
    }
  }, ms)
}

scheduleDailyResetTick()

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect()
  process.exit(0)
})
