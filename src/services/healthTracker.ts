import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import net from 'net'
import dotenv from 'dotenv'

dotenv.config()

interface ProbeResult {
  timestamp: number
  success: boolean
  latencyMs: number
}

const WINDOW_MS = 24 * 60 * 60 * 1000 // 24-hour rolling window
const PROBE_INTERVAL_MS = 30_000       // probe every 30 seconds

class HealthTracker {
  private probes = new Map<string, ProbeResult[]>()
  private currentStatus = new Map<string, boolean>()
  private prisma: PrismaClient | null = null
  private intervalHandle: ReturnType<typeof setInterval> | null = null

  /** Call once from server.ts after prisma is ready */
  start(prismaClient: PrismaClient) {
    this.prisma = prismaClient
    // Run immediately, then on interval
    this.runAll()
    this.intervalHandle = setInterval(() => this.runAll(), PROBE_INTERVAL_MS)
  }

  stop() {
    if (this.intervalHandle) clearInterval(this.intervalHandle)
  }

  // ── recording ────────────────────────────────────────────────────────────

  private record(service: string, success: boolean, latencyMs: number) {
    if (!this.probes.has(service)) this.probes.set(service, [])
    const results = this.probes.get(service)!
    const now = Date.now()
    results.push({ timestamp: now, success, latencyMs })
    this.currentStatus.set(service, success)
    // Evict results older than the window
    const cutoff = now - WINDOW_MS
    let i = 0
    while (i < results.length && results[i].timestamp < cutoff) i++
    if (i > 0) results.splice(0, i)
  }

  // ── uptime calculation ────────────────────────────────────────────────────

  getUptime(service: string): string {
    const results = this.probes.get(service)
    if (!results || results.length === 0) return '—'
    const successes = results.filter(r => r.success).length
    const pct = (successes / results.length) * 100
    return pct.toFixed(1) + '%'
  }

  isHealthy(service: string): boolean | null {
    if (!this.currentStatus.has(service)) return null
    return this.currentStatus.get(service) ?? null
  }

  getLatest(service: string): ProbeResult | null {
    const results = this.probes.get(service)
    if (!results || results.length === 0) return null
    return results[results.length - 1]
  }

  // ── individual probes ─────────────────────────────────────────────────────

  async probeDatabase() {
    if (!this.prisma) return
    const start = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      this.record('db', true, Date.now() - start)
    } catch {
      this.record('db', false, Date.now() - start)
    }
  }

  async probeSms() {
    const apiUrl = process.env.SLT_SMS_API_URL || 'https://smsc.slt.lk:8093'
    const configured = !!(
      process.env.SLT_SMS_USERNAME &&
      process.env.SLT_SMS_PASSWORD &&
      process.env.SLT_SMS_ALIAS
    )
    if (!configured) {
      this.record('sms', false, 0)
      return
    }
    const start = Date.now()
    try {
      // Parse host + port from the URL for a lightweight TCP reachability check
      const url = new URL(apiUrl)
      const host = url.hostname
      const port = parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10)
      await tcpPing(host, port, 5000)
      this.record('sms', true, Date.now() - start)
    } catch {
      this.record('sms', false, Date.now() - start)
    }
  }

  async probeEmail() {
    const configured = !!(
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    )
    if (!configured) {
      this.record('email', false, 0)
      return
    }
    const start = Date.now()
    try {
      const host = process.env.SMTP_HOST!
      const port = parseInt(process.env.SMTP_PORT || '587', 10)
      await tcpPing(host, port, 5000)
      this.record('email', true, Date.now() - start)
    } catch {
      this.record('email', false, Date.now() - start)
    }
  }

  async probeAppServer() {
    // App server is "up" if we're running this code
    this.record('app', true, 0)
  }

  private async runAll() {
    await Promise.allSettled([
      this.probeAppServer(),
      this.probeDatabase(),
      this.probeSms(),
      this.probeEmail(),
    ])
  }
}

/** Lightweight TCP connectivity test */
function tcpPing(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false
    const done = (err?: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      err ? reject(err) : resolve()
    }
    socket.setTimeout(timeoutMs)
    socket.connect(port, host, () => done())
    socket.on('error', done)
    socket.on('timeout', () => done(new Error('timeout')))
  })
}

export const healthTracker = new HealthTracker()
