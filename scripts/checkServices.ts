import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkServices() {
  console.log('=== CHECKING SERVICES ===\n')

  try {
    const services = await prisma.service.findMany({
      select: {
        id: true,
        code: true,
        title: true,
        isActive: true,
      },
      orderBy: { code: 'asc' }
    })

    console.log(`Found ${services.length} services:\n`)
    
    for (const service of services) {
      const status = service.isActive ? '✅' : '❌'
      console.log(`${status} ${service.code} - ${service.title}`)
      console.log(`   ID: ${service.id}`)
      console.log()
    }

    // Get all officers and their services
    const officers = await prisma.officer.findMany({
      select: {
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

    console.log('\n=== OFFICERS AND THEIR ASSIGNED SERVICES ===\n')
    
    for (const officer of officers) {
      const assignedServices = parseJsonArray(officer.assignedServices)
      console.log(`${officer.name}:`)
      console.log(`  ${assignedServices.join(', ')}`)
      console.log()
    }

    // Show which service codes are missing from officers
    const allServiceCodes = services.filter(s => s.isActive).map(s => s.code)
    const allServiceIds = services.filter(s => s.isActive).map(s => s.id)

    console.log('\n✅ Active service codes:', allServiceCodes.join(', '))
    console.log('\n✅ Active service IDs:', allServiceIds.join(', '))

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkServices()
