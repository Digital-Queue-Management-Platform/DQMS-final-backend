import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  // Find the default region
  const region = await prisma.region.findFirst({ where: { name: "Default Region" } })
  
  if (!region) {
    console.log("Default Region not found. Please run seedOutlets.ts first.")
    return
  }

  console.log("Found region:", region.id, region.name)

  // Assign a test manager to the region
  const testManager = {
    managerId: "test-manager-id",
    managerEmail: "manager@test.com", 
    managerMobile: "+94771234567"
  }

  const updatedRegion = await prisma.region.update({
    where: { id: region.id },
    data: {
      managerId: testManager.managerId,
      managerEmail: testManager.managerEmail,
      managerMobile: testManager.managerMobile
    }
  })

  console.log("✅ Assigned manager to region:")
  console.log("Manager ID:", updatedRegion.managerId)
  console.log("Manager Email:", updatedRegion.managerEmail)
  console.log("Manager Mobile:", updatedRegion.managerMobile)
  
  // Verify outlets are available for this manager
  const regionWithOutlets = await prisma.region.findFirst({
    where: { id: region.id },
    include: {
      outlets: true
    }
  })
  
  console.log(`✅ Manager now has access to ${regionWithOutlets?.outlets.length} outlets:`)
  regionWithOutlets?.outlets.forEach((outlet, index) => {
    console.log(`  ${index + 1}. ${outlet.name} (${outlet.location}) - Active: ${outlet.isActive}`)
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })