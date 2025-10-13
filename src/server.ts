import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import dotenv from "dotenv"
import { WebSocketServer } from "ws"
import { createServer } from "http"
import { PrismaClient } from "@prisma/client"

// Import routes
import customerRoutes from "./routes/customer.routes"
import officerRoutes from "./routes/officer.routes"
import adminRoutes from "./routes/admin.routes"
import queueRoutes from "./routes/queue.routes"
import feedbackRoutes from "./routes/feedback.routes"
import documentRoutes from "./routes/document.routes"
import managerRoutes from "./routes/manager.routes"

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
const LONG_WAIT_CHECK_MS = 1000 * 60 // check every minute

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

setInterval(checkLongWait, LONG_WAIT_CHECK_MS)

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect()
  process.exit(0)
})
