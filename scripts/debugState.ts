import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log('\n=== Officers ===')
  const officers = await prisma.officer.findMany({ include: { outlet: true } })
  console.log(JSON.stringify(officers, null, 2))

  console.log('\n=== Waiting Tokens ===')
  const waiting = await prisma.token.findMany({ where: { status: 'waiting' }, include: { customer: true, outlet: true } })
  console.log(JSON.stringify(waiting, null, 2))

  console.log('\n=== In-service Tokens ===')
  const inService = await prisma.token.findMany({ where: { status: 'in_service' }, include: { customer: true, officer: true } })
  console.log(JSON.stringify(inService, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
