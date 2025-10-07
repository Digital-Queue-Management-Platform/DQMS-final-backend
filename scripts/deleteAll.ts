import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("Deleting all records...")

  // Delete in order to respect foreign key constraints
  await prisma.feedback.deleteMany()
  console.log("✓ Deleted all feedback")
  
  await prisma.token.deleteMany()
  console.log("✓ Deleted all tokens")
  
  await prisma.officer.deleteMany()
  console.log("✓ Deleted all officers")
  
  await prisma.outlet.deleteMany()
  console.log("✓ Deleted all outlets")
  
  await prisma.region.deleteMany()
  console.log("✓ Deleted all regions")

  await prisma.customer.deleteMany()
  console.log("✓ Deleted all customers")

  await prisma.alert.deleteMany()
  console.log("✓ Deleted all alerts")

  await prisma.service.deleteMany()
  console.log("✓ Deleted all services")

  await prisma.document.deleteMany()
  console.log("✓ Deleted all documents")

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