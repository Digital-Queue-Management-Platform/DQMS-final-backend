import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Seeding mock completed services for today...")

  // 1. Get or create the Outlet (Teleshop Maharagama)
  let outlet = await prisma.outlet.findFirst({
    where: { name: { contains: "Maharagama", mode: "insensitive" } }
  })

  if (!outlet) {
    // If not found, get any active outlet
    outlet = await prisma.outlet.findFirst()
  }

  if (!outlet) {
    // Create a default outlet
    console.log("No outlet found, creating Teleshop Maharagama...")
    
    // Get or create region
    let region = await prisma.region.findFirst()
    if (!region) {
      region = await prisma.region.create({
        data: { name: "Western Region" }
      })
    }

    outlet = await prisma.outlet.create({
      data: {
        name: "Teleshop Maharagama",
        location: "Maharagama",
        regionId: region.id,
        counterCount: 5,
        isActive: true
      }
    })
  }

  console.log(`Using Outlet: ${outlet.name} (${outlet.id})`)

  // 2. Get or create an Officer in this Outlet
  let officer = await prisma.officer.findFirst({
    where: { outletId: outlet.id }
  })

  if (!officer) {
    console.log("No officer found for this outlet, creating one...")
    officer = await prisma.officer.create({
      data: {
        name: "Samantha Silva",
        mobileNumber: "0771234567",
        outletId: outlet.id,
        counterNumber: 1,
        status: "available"
      }
    })
  }
  console.log(`Using Officer: ${officer.name} (${officer.id})`)

  // 3. Get or create a Customer
  let customer = await prisma.customer.findFirst()
  if (!customer) {
    console.log("No customer found, creating one...")
    customer = await prisma.customer.create({
      data: {
        name: "Kumara Perera",
        mobileNumber: "0712345678",
        sltMobileNumber: "0712345678",
        email: "kumara@gmail.com",
        nicNumber: "199012345678"
      }
    })
  }
  console.log(`Using Customer: ${customer.name} (${customer.id})`)

  // 4. Get or create Services
  let service = await prisma.service.findFirst()
  if (!service) {
    console.log("No service found, creating one...")
    service = await prisma.service.create({
      data: {
        code: "SVC001",
        title: "Bill Payment",
        description: "Pay SLT/Mobitel Bills",
        isActive: true,
        order: 1
      }
    })
  }
  console.log(`Using Service: ${service.title} (${service.id})`)

  // 5. Get or create the Teleshop Manager for this outlet to link completed services
  let manager = await prisma.teleshopManager.findFirst({
    where: { branchId: outlet.id }
  })

  if (!manager) {
    console.log("No manager found for this outlet, creating one...")
    manager = await prisma.teleshopManager.create({
      data: {
        name: "Maharagama Manager",
        mobileNumber: "0769999999",
        regionId: outlet.regionId,
        branchId: outlet.id,
        isActive: true
      }
    })
  }
  console.log(`Using Manager: ${manager.name} (${manager.id})`)

  // 6. Create 3 Mock Completed Tokens & CompletedService records for today!
  const today = new Date()
  const mockTokensData = [
    { tokenNum: 101, duration: 8, notes: "Broadband connection upgrade completed successfully." },
    { tokenNum: 102, duration: 5, notes: "Monthly bill settlement processed via credit card." },
    { tokenNum: 103, duration: 12, notes: "Sim card replacement and eSIM activation completed." }
  ]

  for (const data of mockTokensData) {
    // Generate a unique token
    const token = await prisma.token.create({
      data: {
        tokenNumber: data.tokenNum,
        customerId: customer.id,
        outletId: outlet.id,
        assignedTo: officer.id,
        counterNumber: officer.counterNumber,
        status: "completed",
        createdAt: new Date(today.getTime() - 20 * 60 * 1000), // 20 mins ago
        calledAt: new Date(today.getTime() - 15 * 60 * 1000), // 15 mins ago
        startedAt: new Date(today.getTime() - 12 * 60 * 1000), // 12 mins ago
        completedAt: today,
        serviceTypes: [service.code]
      }
    })

    // Create the CompletedService record
    await (prisma as any).completedService.create({
      data: {
        tokenId: token.id,
        serviceId: service.id,
        officerId: officer.id,
        teleshopManagerId: manager.id,
        customerId: customer.id,
        outletId: outlet.id,
        duration: data.duration,
        notes: data.notes,
        completedAt: today
      }
    })

    // Create the ServiceCase tracking record
    const refNumber = `${today.toISOString().slice(0, 10)}/${outlet.name.replace(/\//g, "-")}/${token.tokenNumber}-${token.id.substring(0, 4)}`
    await (prisma as any).serviceCase.create({
      data: {
        refNumber,
        tokenId: token.id,
        outletId: outlet.id,
        officerId: officer.id,
        customerId: customer.id,
        serviceTypes: [service.code],
        status: "completed",
        completedAt: today
      }
    })

    console.log(`✓ Created Completed Token & Service #${data.tokenNum}`)
  }

  console.log("✨ Seeding completed successfully! All records created for today.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
