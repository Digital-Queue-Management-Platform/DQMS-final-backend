import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("Deleting all records...")

  // Delete in order to respect foreign key constraints
  await prisma.feedback.deleteMany()
  console.log("✓ Deleted all feedback")

  // Tokens depend on Customer/Officer/Outlet, so delete them early
  await prisma.token.deleteMany()
  console.log("✓ Deleted all tokens")

  // Break logs depend on Officer, must be deleted before officers
  await prisma.breakLog.deleteMany()
  console.log("✓ Deleted all break logs")

  // Standalone entities (no FKs) can be deleted anytime
  await prisma.alert.deleteMany()
  console.log("✓ Deleted all alerts")

  await prisma.document.deleteMany()
  console.log("✓ Deleted all documents")

  await prisma.service.deleteMany()
  console.log("✓ Deleted all services")

  // Now delete dependents that point to parents
  await prisma.officer.deleteMany()
  console.log("✓ Deleted all officers")

  await prisma.customer.deleteMany()
  console.log("✓ Deleted all customers")

  await prisma.outlet.deleteMany()
  console.log("✓ Deleted all outlets")

  await prisma.region.deleteMany()
  console.log("✓ Deleted all regions")

  console.log("\nAll records deleted successfully!")
}

main()
  .catch((e) => {
    console.error("Error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })