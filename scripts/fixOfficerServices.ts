import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixOfficerServices() {
  console.log('=== FIXING OFFICER SERVICES ===\n')

  try {
    // Get all officers
    const officers = await prisma.officer.findMany({
      select: {
        id: true,
        name: true,
        assignedServices: true,
      },
    })

    const parseJsonArray = (val: any): string[] => {
      try {
        if (!val) return []
        if (Array.isArray(val)) return val as string[]
        if (typeof val === 'string') return JSON.parse(val)
        if (typeof val === 'object') return Object.values(val).filter(v => typeof v === 'string') as string[]
      } catch { }
      return []
    }

    // Get all unique service codes from waiting tokens
    const waitingTokens = await prisma.token.findMany({
      where: {
        status: {
          in: ['waiting', 'skipped']
        },
      },
      select: {
        serviceTypes: true,
      },
    })

    const allServiceCodes = new Set<string>()
    for (const token of waitingTokens) {
      const services = Array.isArray(token.serviceTypes) ? token.serviceTypes as string[] : []
      services.forEach(s => allServiceCodes.add(s))
    }

    console.log('Service codes in waiting tokens:', Array.from(allServiceCodes).join(', '))
    console.log()

    // Update each officer to include all service codes
    for (const officer of officers) {
      const currentServices = parseJsonArray(officer.assignedServices)
      const allServices = new Set([...currentServices, ...Array.from(allServiceCodes)])

      const updatedServices = Array.from(allServices)

      console.log(`Updating ${officer.name}:`)
      console.log(`  Before: ${currentServices.join(', ')}`)
      console.log(`  After:  ${updatedServices.join(', ')}`)

      await prisma.officer.update({
        where: { id: officer.id },
        data: {
          assignedServices: updatedServices,
        },
      })

      console.log('  ✅ Updated\n')
    }

    console.log('=== FIX COMPLETE ===')
    console.log('All officers now have all service codes from waiting tokens.')

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixOfficerServices()
