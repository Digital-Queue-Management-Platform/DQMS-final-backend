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
import ttsRoutes from "./routes/tts.routes"
import serviceCaseRoutes from "./routes/service-case.routes"
import gmRoutes from "./routes/gm.routes"
import dgmRoutes from "./routes/dgm.routes"
import kioskRoutes from "./routes/kiosk.routes"
import billRoutes from "./routes/bill.routes"
import sltSmsRoutes from "./routes/slt-sms.routes"
import { healthTracker } from "./services/healthTracker"

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})
const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: "/ws" })

// Health check endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" })
})

// CORS
const frontendOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map((s) => s.trim())

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (frontendOrigins.includes(origin)) return callback(null, true)

      logger.warn({ origin }, "CORS_NOT_ALLOWED")
      return callback(new Error(`CORS not allowed for origin: ${origin}`))
    },
    credentials: true,
  })
)

app.use(compression({ threshold: Number(process.env.COMPRESS_THRESHOLD || 1024) }))
app.use(cookieParser())
app.use(express.json({ limit: '20mb' }))
app.use("/uploads", express.static("uploads"))

// Performance instrumentation
const perfLogThreshold = Number(process.env.PERF_LOG_THRESHOLD_MS || 200)
interface MetricStats { count: number; total: number; max: number; samples: number[] }
const routeMetrics = new Map<string, MetricStats>()

function recordMetric(key: string, dur: number) {
  let stats = routeMetrics.get(key)
  if (!stats) {
    stats = { count: 0, total: 0, max: 0, samples: [] }
    routeMetrics.set(key, stats)
  }
  stats.count++
  stats.total += dur
  if (dur > stats.max) stats.max = dur

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
        logger.warn(
          { durMs: Number(durMs.toFixed(1)), method: req.method, url: req.originalUrl },
          'slow_request'
        )
      }
    })
    next()
  })
}

// WebSocket
wss.on("connection", (ws) => {
  logger.debug("WS client connected")

  ws.on("close", () => {
    logger.debug("WS client disconnected")
  })
})

export const broadcast = (data: any) => {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
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
app.use("/api/tts", ttsRoutes)
app.use("/api/appointment", appointmentRoutes)
app.use("/api/service-case", serviceCaseRoutes)
app.use("/api/kiosk", kioskRoutes)
app.use("/api/bills", billRoutes)
app.use("/api/slt-sms", sltSmsRoutes)
app.use("/api/gm", gmRoutes)
app.use("/api/dgm", dgmRoutes)

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

function isRecurringNoticeActive(notice: any, now: Date): boolean {
  if (!notice.isRecurring || notice.recurringType !== "weekly") return false
  if (notice.recurringEndDate && new Date(notice.recurringEndDate) < now) return false

  const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
  const todayName = dayNames[now.getDay()]
  const days: string[] = Array.isArray(notice.recurringDays) ? notice.recurringDays : []
  if (!days.includes(todayName)) return false

  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  if (notice.recurringStartTime && notice.recurringEndTime) {
    const startMinutes = parseTimeToMinutes(notice.recurringStartTime)
    const endMinutes = parseTimeToMinutes(notice.recurringEndTime)
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes
  }

  const startTemplate = new Date(notice.startsAt)
  const endTemplate = new Date(notice.endsAt)
  const startMinutes = startTemplate.getHours() * 60 + startTemplate.getMinutes()
  const endMinutes = endTemplate.getHours() * 60 + endTemplate.getMinutes()
  return nowMinutes >= startMinutes && nowMinutes <= endMinutes
}

app.get("/api/branch-status/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params
    const atParam = req.query.at
    const now = atParam ? new Date(atParam as string) : new Date()
    if (isNaN(now.getTime())) {
      return res.status(400).json({ error: "Invalid 'at' date provided" })
    }

    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(now)
    todayEnd.setHours(23, 59, 59, 999)

    const [holidays, activeOneTime, recurringClosure, activeStandardOneTime, recurringStandard] = await Promise.all([
      (prisma as any).mercantileHoliday.findMany({ select: { date: true, name: true, isRecurring: true } }),
      (prisma as any).closureNotice.findFirst({
        where: { outletId, isRecurring: false, startsAt: { lte: now }, endsAt: { gte: now }, noticeType: "closure" },
        orderBy: { createdAt: "desc" },
        select: { title: true, message: true }
      }),
      (prisma as any).closureNotice.findMany({
        where: { outletId, isRecurring: true, noticeType: "closure" },
        select: { title: true, message: true, isRecurring: true, recurringType: true, recurringDays: true, recurringEndDate: true, recurringStartTime: true, recurringEndTime: true, startsAt: true, endsAt: true }
      }),
      (prisma as any).closureNotice.findFirst({
        where: { outletId, noticeType: "standard", isRecurring: false, startsAt: { lte: now }, endsAt: { gte: now } },
        orderBy: { createdAt: "desc" },
        select: { title: true, message: true }
      }),
      (prisma as any).closureNotice.findMany({
        where: { outletId, noticeType: "standard", isRecurring: true },
        select: { title: true, message: true, isRecurring: true, recurringType: true, recurringDays: true, recurringEndDate: true, recurringStartTime: true, recurringEndTime: true, startsAt: true, endsAt: true }
      }),
    ])

    for (const holiday of holidays) {
      const hDate = new Date(holiday.date)
      if (holiday.isRecurring) {
        if (hDate.getMonth() === now.getMonth() && hDate.getDate() === now.getDate()) {
          return res.json({ isClosed: true, reason: `Mercantile Holiday: ${holiday.name}`, activeNotice: null, standardNotice: null })
        }
      } else {
        if (hDate >= todayStart && hDate <= todayEnd) {
          return res.json({ isClosed: true, reason: `Mercantile Holiday: ${holiday.name}`, activeNotice: null, standardNotice: null })
        }
      }
    }

    if (activeOneTime) {
      return res.json({
        isClosed: true,
        reason: activeOneTime.title,
        activeNotice: { title: activeOneTime.title, message: activeOneTime.message },
        standardNotice: null
      })
    }

    for (const rn of recurringClosure) {
      if (isRecurringNoticeActive(rn, now)) {
        return res.json({
          isClosed: true,
          reason: rn.title,
          activeNotice: { title: rn.title, message: rn.message },
          standardNotice: null
        })
      }
    }

    let standardNotice: { title: string; message: string } | null = null
    if (activeStandardOneTime) {
      standardNotice = { title: activeStandardOneTime.title, message: activeStandardOneTime.message }
    } else {
      for (const rs of recurringStandard) {
        if (isRecurringNoticeActive(rs, now)) {
          standardNotice = { title: rs.title, message: rs.message }
          break
        }
      }
    }

    res.set("Cache-Control", "no-store")
    res.json({ isClosed: false, reason: null, activeNotice: null, standardNotice })
  } catch (err) {
    logger.error({ err }, "Branch-status check error")
    res.status(500).json({ error: "Failed to check branch status" })
  }
})

app.get("/api/outlet-notices/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params
    const now = new Date()

    const [oneTime, recurring] = await Promise.all([
      (prisma as any).closureNotice.findMany({
        where: { outletId, noticeType: "standard", isRecurring: false, startsAt: { lte: now }, endsAt: { gte: now } },
        orderBy: { createdAt: "desc" },
        select: { title: true, message: true }
      }),
      (prisma as any).closureNotice.findMany({
        where: { outletId, noticeType: "standard", isRecurring: true },
        select: { title: true, message: true, isRecurring: true, recurringType: true, recurringDays: true, recurringEndDate: true, recurringStartTime: true, recurringEndTime: true, startsAt: true, endsAt: true }
      }),
    ])

    const activeRecurring = recurring.filter((n: any) => isRecurringNoticeActive(n, now))
    const notices = [...oneTime, ...activeRecurring]
    res.set("Cache-Control", "no-store")
    res.json({ notices })
  } catch (err) {
    logger.error({ err }, "Outlet-notices check error")
    res.status(500).json({ error: "Failed to fetch outlet notices" })
  }
})

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
    out[key] = {
      count: stats.count,
      avg: Number(avg.toFixed(2)),
      max: Number(stats.max.toFixed(2)),
      p95: Number(p95.toFixed(2))
    }
  }
  res.set('Cache-Control', 'no-store')
  res.json({ generatedAt: new Date().toISOString(), routes: out })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
  healthTracker.start(prisma)
})

const LONG_WAIT_MINUTES = Number(process.env.LONG_WAIT_MINUTES || 10)
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

if (process.env.DISABLE_LONG_WAIT_JOB !== "true") {
  setInterval(checkLongWait, LONG_WAIT_CHECK_MS)
}

const APPOINTMENT_ENQUEUE_AHEAD_MIN = Number(process.env.APPOINTMENT_ENQUEUE_AHEAD_MIN || 15)
const APPOINTMENT_POLL_MS = 60 * 1000

async function processAppointments() {
  try {
    const now = new Date()
    const ahead = new Date(now.getTime() + APPOINTMENT_ENQUEUE_AHEAD_MIN * 60 * 1000)

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
          const apptRows = await (tx as any).$queryRaw`SELECT * FROM "Appointment" WHERE "id" = ${appt.id} FOR UPDATE`
          const apptRow: any = Array.isArray(apptRows) ? apptRows[0] : null
          if (!apptRow || apptRow.status !== 'booked') return

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
            let customer = await tx.customer.findFirst({ where: { mobileNumber: apptRow.mobileNumber } })
            if (!customer) {
              customer = await tx.customer.create({ data: { name: apptRow.name, mobileNumber: apptRow.mobileNumber } })
            }

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

          await tx.$executeRaw`
            UPDATE "Appointment"
            SET "status" = 'queued', "queuedAt" = now(), "tokenId" = ${tokenId}
            WHERE "id" = ${apptRow.id}
          `

          return { createdTokenId, outletId: apptRow.outletId }
        }, { timeout: 10000 })

        if (result?.createdTokenId) {
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

function scheduleDailyResetTick() {
  const next = getNextDailyReset()
  const ms = Math.max(0, next.getTime() - Date.now())
  logger.info(`Next daily reset at ${next.toLocaleString()} (in ${(ms / 1000 / 60).toFixed(1)} minutes)`)
  setTimeout(async () => {
    try {
      const ts = new Date()
      logger.info(`Daily reset boundary reached: ${ts.toLocaleString()}`)

      await prisma.officer.updateMany({
        where: {
          OR: [
            { counterNumber: { not: null } },
            { status: { not: "offline" } }
          ]
        },
        data: {
          counterNumber: null,
          status: "offline"
        }
      })
      logger.info('All officer counter assignments reset')

      broadcast({ type: "DAILY_RESET", data: { timestamp: ts.toISOString() } })
    } catch (e) {
      logger.error({ err: e }, "Error during daily reset")
    } finally {
      scheduleDailyResetTick()
    }
  }, ms)
}

scheduleDailyResetTick()

if (process.env.DISABLE_DB_KEEPALIVE !== "true") {
  setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (err) {
      logger.warn({ err }, "DB keep-alive ping failed")
    }
  }, 4 * 60 * 1000)
}

process.on("SIGINT", async () => {
  await prisma.$disconnect()
  process.exit(0)
})