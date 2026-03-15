import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()

type BackupFile = {
  exportedAt?: string
  version?: string
  tables: Record<string, any[]>
  counts?: Record<string, number>
}

const ORDERED_TABLES = [
  'regions',
  'services',
  'gms',
  'customers',
  'otps',
  'sltBills',
  'mercantileHolidays',
  'documents',
  'alerts',
  'outlets',
  'dgms',
  'officers',
  'teleshopManagers',
  'managerQRTokens',
  'closureNotices',
  'appointments',
  'tokens',
  'breakLogs',
  'feedback',
  'completedServices',
  'transferLogs',
  'serviceCases',
  'serviceCaseUpdates',
] as const

async function createManyByKey(key: string, rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { count: 0 }
  }

  switch (key) {
    case 'regions':
      return prisma.region.createMany({ data: rows, skipDuplicates: true })
    case 'services':
      return prisma.service.createMany({ data: rows, skipDuplicates: true })
    case 'gms':
      return (prisma as any).gM.createMany({ data: rows, skipDuplicates: true })
    case 'customers':
      return prisma.customer.createMany({ data: rows, skipDuplicates: true })
    case 'otps':
      return (prisma as any).oTP.createMany({ data: rows, skipDuplicates: true })
    case 'sltBills':
      return (prisma as any).sltBill.createMany({ data: rows, skipDuplicates: true })
    case 'mercantileHolidays':
      return (prisma as any).mercantileHoliday.createMany({ data: rows, skipDuplicates: true })
    case 'documents':
      return prisma.document.createMany({ data: rows, skipDuplicates: true })
    case 'alerts':
      return prisma.alert.createMany({ data: rows, skipDuplicates: true })
    case 'outlets':
      return prisma.outlet.createMany({ data: rows, skipDuplicates: true })
    case 'dgms':
      return (prisma as any).dGM.createMany({ data: rows, skipDuplicates: true })
    case 'officers':
      return prisma.officer.createMany({ data: rows, skipDuplicates: true })
    case 'teleshopManagers':
      return prisma.teleshopManager.createMany({ data: rows, skipDuplicates: true })
    case 'managerQRTokens':
      return prisma.managerQRToken.createMany({ data: rows, skipDuplicates: true })
    case 'closureNotices':
      return prisma.closureNotice.createMany({ data: rows, skipDuplicates: true })
    case 'appointments':
      return prisma.appointment.createMany({ data: rows, skipDuplicates: true })
    case 'tokens':
      return prisma.token.createMany({ data: rows, skipDuplicates: true })
    case 'breakLogs':
      return prisma.breakLog.createMany({ data: rows, skipDuplicates: true })
    case 'feedback':
      return prisma.feedback.createMany({ data: rows, skipDuplicates: true })
    case 'completedServices':
      return prisma.completedService.createMany({ data: rows, skipDuplicates: true })
    case 'transferLogs':
      return prisma.transferLog.createMany({ data: rows, skipDuplicates: true })
    case 'serviceCases':
      return prisma.serviceCase.createMany({ data: rows, skipDuplicates: true })
    case 'serviceCaseUpdates':
      return prisma.serviceCaseUpdate.createMany({ data: rows, skipDuplicates: true })
    default:
      return { count: 0 }
  }
}

async function createManyWithColumnFallback(key: string, rows: any[]) {
  let safeRows = rows

  for (let i = 0; i < 10; i++) {
    try {
      return await createManyByKey(key, safeRows)
    } catch (error: any) {
      if (error?.code !== 'P2022') {
        throw error
      }

      const missingColumn = error?.meta?.column as string | undefined
      if (!missingColumn) {
        throw error
      }

      const normalized = missingColumn.replace(/"/g, '')
      const before = safeRows.length
      safeRows = safeRows.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return row
        const copy = { ...row }
        delete (copy as any)[normalized]
        return copy
      })

      if (before > 0) {
        console.log(`Skipped missing column '${normalized}' for table ${key} and retrying`)
      }
    }
  }

  throw new Error(`Could not restore table ${key} after removing missing columns`)
}

async function countByKey(key: string): Promise<number> {
  switch (key) {
    case 'regions':
      return prisma.region.count()
    case 'services':
      return prisma.service.count()
    case 'gms':
      return (prisma as any).gM.count()
    case 'customers':
      return prisma.customer.count()
    case 'otps':
      return (prisma as any).oTP.count()
    case 'sltBills':
      return (prisma as any).sltBill.count()
    case 'mercantileHolidays':
      return (prisma as any).mercantileHoliday.count()
    case 'documents':
      return prisma.document.count()
    case 'alerts':
      return prisma.alert.count()
    case 'outlets':
      return prisma.outlet.count()
    case 'dgms':
      return (prisma as any).dGM.count()
    case 'officers':
      return prisma.officer.count()
    case 'teleshopManagers':
      return prisma.teleshopManager.count()
    case 'managerQRTokens':
      return prisma.managerQRToken.count()
    case 'closureNotices':
      return prisma.closureNotice.count()
    case 'appointments':
      return prisma.appointment.count()
    case 'tokens':
      return prisma.token.count()
    case 'breakLogs':
      return prisma.breakLog.count()
    case 'feedback':
      return prisma.feedback.count()
    case 'completedServices':
      return prisma.completedService.count()
    case 'transferLogs':
      return prisma.transferLog.count()
    case 'serviceCases':
      return prisma.serviceCase.count()
    case 'serviceCaseUpdates':
      return prisma.serviceCaseUpdate.count()
    default:
      return 0
  }
}

async function main() {
  const argPath = process.argv[2]
  const backupPath = argPath
    ? path.resolve(argPath)
    : path.resolve('..', 'Downloads', 'dqmp-backup-2026-03-15T05-07-15.json')

  console.log(`Using backup file: ${backupPath}`)

  const raw = await readFile(backupPath, 'utf8')
  const parsed: BackupFile = JSON.parse(raw)

  if (!parsed?.tables || typeof parsed.tables !== 'object') {
    throw new Error('Invalid backup format: missing tables object')
  }

  const inserted: Record<string, number> = {}

  for (const key of ORDERED_TABLES) {
    const rows = parsed.tables[key] || []
    if (!Array.isArray(rows) || rows.length === 0) {
      inserted[key] = 0
      continue
    }

    const r = await createManyWithColumnFallback(key, rows)
    inserted[key] = r.count
    console.log(`Inserted ${r.count} row(s) into ${key}`)
  }

  console.log('\nVerification counts:')
  for (const key of ORDERED_TABLES) {
    const expected = parsed.counts?.[key] ?? (Array.isArray(parsed.tables[key]) ? parsed.tables[key].length : 0)
    const actual = await countByKey(key)
    const status = actual >= expected ? 'OK' : 'MISMATCH'
    console.log(`${status} ${key}: expected >= ${expected}, actual ${actual}, inserted ${inserted[key]}`)
  }
}

main()
  .catch((error) => {
    console.error('Restore failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
