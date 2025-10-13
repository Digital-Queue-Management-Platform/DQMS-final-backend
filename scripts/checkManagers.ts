import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function checkManagerData() {
  try {
    console.log("Checking manager data in database...")
    
    // Find all regions with manager data
    const regions = await prisma.region.findMany({
      where: {
        OR: [
          { managerEmail: { not: null } },
          { managerId: { not: null } }
        ]
      }
    })
    
    console.log("Found regions with manager data:")
    regions.forEach(region => {
      console.log(`- Region: ${region.name}`)
      console.log(`  Manager ID: ${region.managerId || 'NULL'}`)
      console.log(`  Manager Email: ${region.managerEmail || 'NULL'}`)
      console.log(`  Manager Mobile: ${region.managerMobile || 'NULL'}`)
      console.log("")
    })
    
    // Check specifically for the email mentioned
    const specific = await prisma.region.findFirst({
      where: { managerEmail: "nisindu@gmail.com" }
    })
    
    if (specific) {
      console.log("✅ Found region for nisindu@gmail.com:")
      console.log(specific)
    } else {
      console.log("❌ No region found for nisindu@gmail.com")
      
      // Show all regions for debugging
      const allRegions = await prisma.region.findMany()
      console.log("\nAll regions in database:")
      allRegions.forEach(region => {
        console.log(`- ${region.name}: managerEmail = "${region.managerEmail}"`)
      })
    }
  } catch (error) {
    console.error("Error checking manager data:", error)
  } finally {
    await prisma.$disconnect()
  }
}

checkManagerData()