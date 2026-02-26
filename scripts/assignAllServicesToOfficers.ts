import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function assignAllServicesToOfficers() {
  console.log('=== ASSIGNING ALL SERVICES TO ALL OFFICERS ===\n')

  try {
    // Get all active services
    const services = await prisma.service.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        title: true,
      },
    })

    console.log(`Found ${services.length} active services:`)
    services.forEach(s => console.log(`  - ${s.code}: ${s.title}`))
    console.log()

    // Extract all service codes and IDs
    const allServiceCodes = services.map(s => s.code)
    const allServiceIds = services.map(s => s.id)

    // Combine both codes and IDs (for backward compatibility)
    const allServices = [...allServiceCodes, ...allServiceIds]

    // Get all officers
    const officers = await prisma.officer.findMany({
      select: {
        id: true,
        name: true,
        assignedServices: true,
      },
    })

    console.log(`Found ${officers.length} officers\n`)

    const parseJsonArray = (val: any): string[] => {
      try {
        if (!val) return []
        if (Array.isArray(val)) return val as string[]
        if (typeof val === 'string') return JSON.parse(val)
        if (typeof val === 'object') return Object.values(val).filter(v => typeof v === 'string') as string[]
      } catch { }
      return []
    }

    // Update each officer
    for (const officer of officers) {
      const currentServices = parseJsonArray(officer.assignedServices)
      const combined = new Set([...currentServices, ...allServices])
      const updatedServices = Array.from(combined)

      console.log(`Updating ${officer.name}:`)
      console.log(`  Current: ${currentServices.length} services`)
      console.log(`  Updated: ${updatedServices.length} services (includes all ${services.length} active service codes + IDs)`)

      await prisma.officer.update({
        where: { id: officer.id },
        data: {
          assignedServices: updatedServices,
        },
      })

      console.log(`  ✅ Updated\n`)
    }

    console.log('=== COMPLETE ===')
    console.log('All officers now have all active service codes and IDs assigned.')
    console.log('They can serve any customer requesting any service.')

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

assignAllServicesToOfficers()
