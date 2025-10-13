import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const regionName = "Default Region"

  let region = await prisma.region.findFirst({ where: { name: regionName } })
  if (!region) {
    region = await prisma.region.create({ data: { name: regionName } })
    console.log("Created region:", region.id, region.name)
  } else {
    console.log("Found existing region:", region.id, region.name)
  }

  const outlets = [
    { name: "Colombo Central", location: "Colombo 01" },
    { name: "Kandy Branch", location: "Kandy" },
  ]

  for (const o of outlets) {
    const existing = await prisma.outlet.findFirst({ where: { name: o.name, location: o.location } })
    if (existing) {
      console.log("Outlet already exists:", existing.id, existing.name)
      continue
    }

    const created = await prisma.outlet.create({
      data: {
        name: o.name,
        location: o.location,
        regionId: region.id,
        isActive: true,
      },
    })

    console.log("Created outlet:", created.id, created.name)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
