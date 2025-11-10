import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import dotenv from "dotenv"
import { WebSocketServer } from "ws"
import { createServer } from "http"
import { PrismaClient } from "@prisma/client"
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

dotenv.config()

export const prisma = new PrismaClient()
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
      // allow requests with no origin (mobile apps, curl)
      if (!origin) return callback(null, true)
      if (frontendOrigins.includes(origin)) return callback(null, true)
      return callback(new Error("CORS not allowed"))
    },
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json())
app.use("/uploads", express.static("uploads"))

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

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
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

    for (const token of tokens) {
      // skip if an alert already exists for this token and type
      const exists = await prisma.alert.findFirst({
        where: { type: "long_wait", relatedEntity: token.id },
      })
      if (exists) continue

      const message = `Token #${token.tokenNumber} has been waiting more than ${LONG_WAIT_MINUTES} minutes at ${token.outlet.name}`
      const alert = await prisma.alert.create({
        data: {
          type: "long_wait",
          severity: "medium",
          message,
          relatedEntity: token.id,
        },
      })

      // Broadcast LONG_WAIT event
      broadcast({ type: "LONG_WAIT", data: { alert, token } })
    }
  } catch (err) {
    console.error("Long-wait check error:", err)
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
    startOfDay.setHours(0,0,0,0)
    const endOfDay = new Date()
    endOfDay.setHours(23,59,59,999)

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
        console.error('Failed to enqueue appointment', appt?.id, e)
      }
    }
  } catch (err) {
    console.error('Appointment processing error:', err)
  }
}

if (process.env.DISABLE_APPOINTMENT_JOB !== 'true') {
  setInterval(processAppointments, APPOINTMENT_POLL_MS)
}

// Daily reset signal: broadcast an event exactly at the configured reset time
function scheduleDailyResetTick() {
  const next = getNextDailyReset()
  const ms = Math.max(0, next.getTime() - Date.now())
  console.log(
    `Next daily reset at ${next.toLocaleString()} (in ${(ms / 1000 / 60).toFixed(1)} minutes)`
  )
  setTimeout(async () => {
    try {
      const ts = new Date()
      console.log(`Daily reset boundary reached: ${ts.toLocaleString()}`)
      // Broadcast a lightweight signal; clients may optionally refresh views
      broadcast({ type: "DAILY_RESET", data: { timestamp: ts.toISOString() } })
    } catch (e) {
      console.error("Error broadcasting DAILY_RESET:", e)
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
