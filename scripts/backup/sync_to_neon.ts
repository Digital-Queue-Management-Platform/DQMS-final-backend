import { PrismaClient } from "@prisma/client"
import * as fs from "fs"
import * as path from "path"
import axios from "axios"
import dotenv from "dotenv"

// Load environment variables from .env
dotenv.config()

// Force the local Prisma client to connect to the LOCAL DB
const LOCAL_DB_URL = "postgresql://postgres:ojitha2026@localhost:5432/dqmp-central-db?schema=public"

// Override environment variable so Prisma connects locally
process.env.DATABASE_URL = LOCAL_DB_URL

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: LOCAL_DB_URL,
    },
  },
})

const NEON_BACKEND_URL = process.env.NEON_BACKEND_URL || "https://sltsecmanage.slt.lk:7443"
const INTERNAL_SECRET = process.env.INTERNAL_BACKUP_SECRET || "dqmp-vm-internal-sync-2026"

const BACKUP_DIR = "C:\\backup"

async function checkScheduleAndRun() {
  console.log("Checking VM to Neon sync schedule...")
  
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  }

  let scheduleTime = "00:00"
  try {
    const res = await axios.get(`${NEON_BACKEND_URL}/api/admin/backup-schedule`, {
      headers: { "x-internal-backup-secret": INTERNAL_SECRET }
    })
    if (res.data?.time) {
      scheduleTime = res.data.time
    }
  } catch (error) {
    console.error("Failed to fetch schedule from Neon backend. Defaulting to 00:00.")
  }

  const [schedHour, schedMin] = scheduleTime.split(":").map(Number)
  const now = new Date()
  const currentHour = now.getHours()
  const currentMin = now.getMinutes()

  // Task scheduler runs every 5 mins. Check if we are in the 5 min window of the schedule.
  const isTimeMatch = currentHour === schedHour && currentMin >= schedMin && currentMin < schedMin + 5

  const todayStr = now.toISOString().split("T")[0]
  const lastSyncFile = path.join(BACKUP_DIR, "last_sync_date.txt")
  let lastSyncDate = ""
  if (fs.existsSync(lastSyncFile)) {
    lastSyncDate = fs.readFileSync(lastSyncFile, "utf-8").trim()
  }

  if (isTimeMatch && lastSyncDate !== todayStr) {
    console.log(`Time match! Schedule is ${scheduleTime}. Executing backup...`)
    await runSync()
    fs.writeFileSync(lastSyncFile, todayStr)
  } else {
    console.log(`No sync needed right now. (Schedule: ${scheduleTime}, Last Sync: ${lastSyncDate || "Never"})`)
    process.exit(0)
  }
}

async function runSync() {
  console.log("Starting VM to Neon sync...")
  try {
    console.log(`Connecting to local DB at ${LOCAL_DB_URL}`)
    
    // Fetch all records
    const [
      regions, outlets, officers, customers, tokens, feedback,
      completedServices, services, appointments, breakLogs, transferLogs,
      serviceCases, serviceCaseUpdates, closureNotices, managerQRTokens,
      teleshopManagers, gms, dgms, otps, sltBills, mercantileHolidays,
      documents, alerts,
    ] = await Promise.all([
      prisma.region.findMany(),
      prisma.outlet.findMany(),
      prisma.officer.findMany(),
      prisma.customer.findMany(),
      prisma.token.findMany(),
      prisma.feedback.findMany(),
      prisma.completedService.findMany(),
      prisma.service.findMany(),
      prisma.appointment.findMany(),
      prisma.breakLog.findMany(),
      prisma.transferLog.findMany(),
      prisma.serviceCase.findMany(),
      prisma.serviceCaseUpdate.findMany(),
      prisma.closureNotice.findMany(),
      prisma.managerQRToken.findMany(),
      prisma.teleshopManager.findMany(),
      (prisma as any).gM.findMany(),
      (prisma as any).dGM.findMany(),
      (prisma as any).oTP.findMany(),
      (prisma as any).sltBill.findMany(),
      (prisma as any).mercantileHoliday.findMany(),
      prisma.document.findMany(),
      prisma.alert.findMany(),
    ])

    const backup = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      tables: {
        regions, outlets, officers, customers, tokens, feedback,
        completedServices, services, appointments, breakLogs, transferLogs,
        serviceCases, serviceCaseUpdates, closureNotices, managerQRTokens,
        teleshopManagers, gms, dgms, otps, sltBills, mercantileHolidays,
        documents, alerts,
      },
      counts: {
        regions: regions.length, outlets: outlets.length, officers: officers.length,
        customers: customers.length, tokens: tokens.length, feedback: feedback.length,
        completedServices: completedServices.length, services: services.length,
        appointments: appointments.length, breakLogs: breakLogs.length, transferLogs: transferLogs.length,
        serviceCases: serviceCases.length, serviceCaseUpdates: serviceCaseUpdates.length,
        closureNotices: closureNotices.length, managerQRTokens: managerQRTokens.length,
        teleshopManagers: teleshopManagers.length, gms: gms.length, dgms: dgms.length,
        otps: otps.length, sltBills: sltBills.length, mercantileHolidays: mercantileHolidays.length,
        documents: documents.length, alerts: alerts.length,
      },
    }

    const filename = `dqmp-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`
    const filePath = path.join(BACKUP_DIR, filename)
    
    // Save locally to C:\backup
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2))
    console.log(`Saved backup locally to ${filePath}`)

    // Clean up old backups in C:\backup (older than 30 days)
    const files = fs.readdirSync(BACKUP_DIR)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    for (const file of files) {
      if (file.endsWith(".json")) {
        const fullPath = path.join(BACKUP_DIR, file)
        const stats = fs.statSync(fullPath)
        if (stats.mtimeMs < thirtyDaysAgo) {
          fs.unlinkSync(fullPath)
          console.log(`Deleted old backup: ${file}`)
        }
      }
    }

    // Post to Neon Backend
    const restoreEndpoint = `${NEON_BACKEND_URL}/api/admin/restore`
    console.log(`Posting backup to Neon Backend at ${restoreEndpoint}`)
    
    const payload = { ...backup, _meta: { filename } }
    
    const response = await axios.post(restoreEndpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-internal-backup-secret": INTERNAL_SECRET
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    })
    
    console.log("Successfully restored to Neon Backend:")
    console.log(response.data)

  } catch (error: any) {
    console.error("Sync failed:")
    console.error(error?.response?.data || error?.message || error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

checkScheduleAndRun()
