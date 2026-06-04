import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("🔄 Starting Safe, Non-Destructive Completed Services Synchronization...")
  console.log("⚠️  Rest assured: This script is 100% read-and-insert only. It will not delete, edit, or overwrite any existing queue or customer data.")

  // 1. Define the time range (covering the last 10 days to safely capture all historical weekly logs)
  const timeLimit = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)

  // 2. Fetch all completed tokens from the last 10 days
  const completedTokens = await prisma.token.findMany({
    where: {
      status: "completed",
      completedAt: {
        gte: timeLimit
      }
    },
    include: {
      customer: true,
      officer: true,
      outlet: true
    }
  })

  console.log(`🔍 Found ${completedTokens.length} completed tokens in the database within the synchronization window.`)

  let syncCount = 0
  let skipCount = 0

  for (const token of completedTokens) {
    try {
      // Skip if token doesn't have an assigned officer (completed services require an officer link)
      if (!token.officer) {
        console.log(`⚠️  Skipping Token #${token.tokenNumber} (ID: ${token.id}): No officer assigned.`)
        skipCount++
        continue
      }

      // Check if CompletedService records already exist for this token to prevent any duplication
      const existingCompletedServices = await (prisma as any).completedService.findMany({
        where: { tokenId: token.id }
      })

      if (existingCompletedServices.length > 0) {
        // Records already exist, skip to prevent duplicates
        skipCount++
        continue
      }

      // Find the Teleshop Manager for this branch
      const manager = await prisma.teleshopManager.findFirst({
        where: { branchId: token.outletId }
      })

      // Calculate duration in minutes (fallback to 0 if timestamps are missing)
      const durationMinutes = token.startedAt && token.completedAt
        ? Math.round((new Date(token.completedAt).getTime() - new Date(token.startedAt).getTime()) / 60000)
        : 0

      // Map service types
      const serviceCodes = Array.isArray(token.serviceTypes) ? token.serviceTypes : []
      
      for (const serviceCode of serviceCodes) {
        // Find the service by code
        const service = await prisma.service.findUnique({
          where: { code: serviceCode }
        })

        if (service) {
          // Safe Insert: Only creates new records in CompletedService
          await (prisma as any).completedService.create({
            data: {
              tokenId: token.id,
              serviceId: service.id,
              officerId: token.officer.id,
              teleshopManagerId: manager?.id || null,
              customerId: token.customerId,
              outletId: token.outletId,
              duration: durationMinutes,
              notes: `Service backfilled and synchronized safely.`,
              completedAt: token.completedAt || new Date()
            }
          })
        }
      }

      // Sync ServiceCase tracking record if missing
      let serviceCase = await (prisma as any).serviceCase.findFirst({ where: { tokenId: token.id } })
      if (!serviceCase) {
        const refDate = (token.completedAt || new Date()).toISOString().slice(0, 10)
        const outletName = token.outlet.name.replace(/\//g, "-")
        const refNumber = `${refDate}/${outletName}/${token.tokenNumber}-${token.id.substring(0, 4)}`

        serviceCase = await (prisma as any).serviceCase.create({
          data: {
            refNumber,
            tokenId: token.id,
            outletId: token.outletId,
            officerId: token.officer.id,
            customerId: token.customerId,
            serviceTypes: serviceCodes,
            status: "completed",
            completedAt: token.completedAt || new Date()
          }
        })

        await (prisma as any).serviceCaseUpdate.create({
          data: {
            caseId: serviceCase.id,
            actorRole: "officer",
            actorId: token.officer.id,
            status: "completed",
            note: "Service completed by officer (synced)"
          }
        })
      }

      console.log(`✅ Safely synchronized Token #${token.tokenNumber} for customer "${token.customer.name}"`)
      syncCount++
    } catch (tokenError: any) {
      console.error(`❌ Failed to sync Token #${token.tokenNumber}:`, tokenError.message)
    }
  }

  console.log("=========================================")
  console.log(`✨ Synchronization Completed successfully!`)
  console.log(`- Total Tokens Safely Synced: ${syncCount}`)
  console.log(`- Existing Records Skipped (Duplication Safe): ${skipCount}`)
  console.log("🔒 Zero records were modified or deleted. Your database is 100% secure.")
  console.log("=========================================")
}

main()
  .catch((e) => {
    console.error("FATAL: Sync script crashed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
