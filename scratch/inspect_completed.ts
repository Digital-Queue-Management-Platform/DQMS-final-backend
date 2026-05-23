import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("🔍 Inspecting Database for Completed Services & Tokens today (2026-05-23)...")

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // 1. Count completed tokens in Token table
  const completedTokensCount = await prisma.token.count({
    where: {
      status: "completed",
      completedAt: {
        gte: today,
        lt: tomorrow
      }
    }
  })

  // 2. Count completed service records in CompletedService table
  const completedServicesCount = await (prisma as any).completedService.count({
    where: {
      completedAt: {
        gte: today,
        lt: tomorrow
      }
    }
  })

  // 3. Count total tokens in outlet (to check if there is an outlet mapping mismatch)
  const maharagamaOutlet = await prisma.outlet.findFirst({
    where: { name: { contains: "Maharagama", mode: "insensitive" } }
  })

  let maharagamaTokens = 0
  let maharagamaCompletedServices = 0
  if (maharagamaOutlet) {
    maharagamaTokens = await prisma.token.count({
      where: {
        outletId: maharagamaOutlet.id,
        status: "completed",
        completedAt: {
          gte: today,
          lt: tomorrow
        }
      }
    })

    maharagamaCompletedServices = await (prisma as any).completedService.count({
      where: {
        outletId: maharagamaOutlet.id,
        completedAt: {
          gte: today,
          lt: tomorrow
        }
      }
    })
  }

  console.log("=========================================")
  console.log(`- Completed Tokens in Database Today: ${completedTokensCount}`)
  console.log(`- CompletedService Records Today: ${completedServicesCount}`)
  if (maharagamaOutlet) {
    console.log(`\nFor ${maharagamaOutlet.name}:`)
    console.log(`- Completed Tokens Today: ${maharagamaTokens}`)
    console.log(`- CompletedService Records Today: ${maharagamaCompletedServices}`)
  }
  console.log("=========================================")
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect()
  })
