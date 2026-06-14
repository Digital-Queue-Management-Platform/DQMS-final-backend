import { PrismaClient } from "@prisma/client"
import * as fs from "fs"
import * as path from "path"
import dotenv from "dotenv"
import { randomUUID } from "crypto"
import sltSmsService from "../../src/services/sltSmsService"
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

const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL
if (!NEON_DATABASE_URL) {
  console.error("CRITICAL ERROR: NEON_DATABASE_URL is not set in .env")
  process.exit(1)
}

const neonPrisma = new PrismaClient({
  datasources: {
    db: {
      url: NEON_DATABASE_URL,
    },
  },
})

const BACKUP_DIR = "C:\\backup"

async function checkScheduleAndRun() {
  console.log("Checking VM to Neon sync schedule...")
  
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  }

  let scheduleTime = "00:00"
  try {
    const setting: any[] = await neonPrisma.$queryRaw`SELECT value FROM "SystemSetting" WHERE key = 'backup_time'`
    if (setting && setting.length > 0) {
      scheduleTime = setting[0].value
    }
  } catch (error) {
    console.error("Failed to fetch schedule from Neon DB. Defaulting to 00:00.", error)
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
    console.log(`Time match! Schedule is ${scheduleTime}. Executing direct database sync...`)
    await runSync()
    fs.writeFileSync(lastSyncFile, todayStr)
  } else {
    console.log(`No sync needed right now. (Schedule: ${scheduleTime}, Last Sync: ${lastSyncDate || "Never"})`)
    process.exit(0)
  }
}

async function runSync() {
  console.log("Starting VM to Neon direct DB sync...")
  try {
    console.log(`Pulling data from local DB...`)
    
    // Fetch all records from the VM database
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
    
    // Save locally to C:\backup for physical fallback
    fs.writeFileSync(filePath, JSON.stringify(backup, null, 2))
    console.log(`Saved physical backup locally to ${filePath}`)

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

    console.log(`Pushing records to Neon Database natively...`)

    const results: Record<string, number> = {}

    const ins = async (tableName: string, data: any[], prismaCall: (safeRows: any[]) => Promise<any>) => {
      if (!Array.isArray(data) || data.length === 0) return
      let safeRows = data
      for (let i = 0; i < 10; i++) {
        try {
          const r = await prismaCall(safeRows)
          results[tableName] = r.count !== undefined ? r.count : data.length
          return
        } catch (error: any) {
          if (error?.code !== 'P2022') throw error
          const missingColumnRaw = error?.meta?.column as string | undefined
          if (!missingColumnRaw) throw error
          const missingColumn = missingColumnRaw.replace(/"/g, '')
          safeRows = safeRows.map((row: any) => {
            const copy = { ...row }
            delete copy[missingColumn]
            return copy
          })
        }
      }
      throw new Error(`Could not restore table '${tableName}' after removing missing columns`)
    }

    // Level 0 — no FK dependencies
    await ins("regions", regions, (safeRows) => neonPrisma.region.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("services", services, (safeRows) => neonPrisma.service.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("gms", gms, (safeRows) => (neonPrisma as any).gM.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("customers", customers, (safeRows) => neonPrisma.customer.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("otps", otps, (safeRows) => (neonPrisma as any).oTP.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("sltBills", sltBills, (safeRows) => (neonPrisma as any).sltBill.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("mercantileHolidays", mercantileHolidays, (safeRows) => (neonPrisma as any).mercantileHoliday.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("documents", documents, (safeRows) => neonPrisma.document.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("alerts", alerts, (safeRows) => neonPrisma.alert.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 1 — depends on regions
    await ins("outlets", outlets, (safeRows) => neonPrisma.outlet.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 2 — depends on gms / outlets
    await ins("dgms", dgms, (safeRows) => (neonPrisma as any).dGM.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("officers", officers, (safeRows) => neonPrisma.officer.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("teleshopManagers", teleshopManagers, (safeRows) => neonPrisma.teleshopManager.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("managerQRTokens", managerQRTokens, (safeRows) => neonPrisma.managerQRToken.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("closureNotices", closureNotices, (safeRows) => neonPrisma.closureNotice.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("appointments", appointments, (safeRows) => neonPrisma.appointment.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 3 — depends on officers / outlets / customers
    await ins("tokens", tokens, (safeRows) => neonPrisma.token.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("breakLogs", breakLogs, (safeRows) => neonPrisma.breakLog.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("transferLogs", transferLogs, (safeRows) => neonPrisma.transferLog.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 4 — depends on tokens
    await ins("feedback", feedback, (safeRows) => neonPrisma.feedback.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("completedServices", completedServices, (safeRows) => neonPrisma.completedService.createMany({ data: safeRows, skipDuplicates: true }))
    await ins("serviceCases", serviceCases, (safeRows) => neonPrisma.serviceCase.createMany({ data: safeRows, skipDuplicates: true }))

    // Level 5 — depends on serviceCases
    await ins("serviceCaseUpdates", serviceCaseUpdates, (safeRows) => neonPrisma.serviceCaseUpdate.createMany({ data: safeRows, skipDuplicates: true }))

    const totalRestored = Object.values(results).reduce((a, b) => a + b, 0)
    console.log(`Successfully synced ${totalRestored} new rows across all tables directly to Neon.`)

    // Log the sync history to the Neon database so it appears on the dashboard
    const historyId = randomUUID()
    const tableCountsJson = JSON.stringify(results)
    
    await neonPrisma.$executeRaw`
      INSERT INTO "BackupRestoreHistory"
      ("id", "action", "status", "filename", "totalRecords", "tableCounts", "createdByRole", "createdAt")
      VALUES
      (
        ${historyId},
        'restore',
        'success',
        ${filename},
        ${totalRestored},
        ${tableCountsJson}::jsonb,
        'vm-script',
        NOW()
      )
    `
    console.log("Successfully logged sync to BackupRestoreHistory.")

    try {
      await sltSmsService.sendSMS({
        to: "0775878565",
        message: `DQMP Auto-Sync: Successfully synced ${totalRestored} new records from VM to Neon Cloud at ${new Date().toLocaleTimeString()}.`
      })
      console.log("Confirmation SMS sent successfully.")
    } catch (smsError) {
      console.error("Failed to send confirmation SMS:", smsError)
    }

  } catch (error: any) {
    console.error("Direct sync failed:")
    console.error(error?.message || error)

    // Log failure
    try {
      const historyId = randomUUID()
      const errMsg = error?.message || 'Unknown error'
      await neonPrisma.$executeRaw`
        INSERT INTO "BackupRestoreHistory"
        ("id", "action", "status", "errorMessage", "createdByRole", "createdAt")
        VALUES
        (
          ${historyId},
          'restore',
          'failed',
          ${errMsg},
          'vm-script',
          NOW()
        )
      `
    } catch (logErr) {
      console.error("Failed to log failure state to DB", logErr)
    }

    process.exit(1)
  } finally {
    await prisma.$disconnect()
    await neonPrisma.$disconnect()
  }
}

checkScheduleAndRun()
