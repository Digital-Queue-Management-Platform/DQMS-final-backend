import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  const now = new Date()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const [tokensToday, all, active, completed, activeOfficers, lastToken] = await Promise.all([
    prisma.token.count({ where: { createdAt: { gte: today } } }),
    prisma.token.count(),
    prisma.token.count({ where: { status: { in: ["waiting", "in_service"] } } }),
    prisma.token.count({ where: { status: "completed" } }),
    prisma.officer.count({ where: { status: { in: ["available", "serving"] } } }),
    prisma.token.findFirst({ orderBy: { createdAt: 'desc' } })
  ])

  console.log({
    today: today.toISOString(),
    now: now.toISOString(),
    tokensToday,
    allTokensCount: all,
    active,
    completed,
    activeOfficers,
    lastTokenCreatedAt: lastToken?.createdAt?.toISOString(),
  })
}

main().catch(console.error).finally(() => prisma.$disconnect())
