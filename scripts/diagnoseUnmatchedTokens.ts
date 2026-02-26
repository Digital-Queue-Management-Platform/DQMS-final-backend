import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function diagnoseUnmatchedTokens() {
  console.log('=== DIAGNOSING UNMATCHED TOKENS ===\n')

  try {
    // Get all officers
    const officers = await prisma.officer.findMany({
      select: {
        id: true,
        name: true,
        outletId: true,
        status: true,
        assignedServices: true,
        languages: true,
      },
    })

    console.log(`\n OFFICERS (${officers.length} total):\n`)

    const parseJsonArray = (val: any): string[] => {
      try {
        if (!val) return []
        if (Array.isArray(val)) return val as string[]
        if (typeof val === 'string') return JSON.parse(val)
        if (typeof val === 'object') return Object.values(val).filter(v => typeof v === 'string') as string[]
      } catch { }
      return []
    }

    let officersWithIssues = 0

    for (const officer of officers) {
      const services = parseJsonArray(officer.assignedServices)
      const langs = parseJsonArray(officer.languages)
      
      const hasIssue = services.length === 0 || langs.length === 0
      if (hasIssue) officersWithIssues++

      const statusEmoji = hasIssue ? '❌' : '✅'
      console.log(`${statusEmoji} ${officer.name} (${officer.status})`)
      console.log(`   Services: ${services.length > 0 ? services.join(', ') : '⚠️  NONE'}`)
      console.log(`   Languages: ${langs.length > 0 ? langs.join(', ') : '⚠️  NONE'}`)
      console.log()
    }

    if (officersWithIssues > 0) {
      console.log(`⚠️  ${officersWithIssues} officers have missing services or languages!\n`)
    }

    // Get waiting tokens
    const waitingTokens = await prisma.token.findMany({
      where: {
        status: {
          in: ['waiting', 'skipped']
        },
      },
      orderBy: { tokenNumber: 'asc' },
      include: {
        customer: true,
        outlet: true,
      },
      take: 50,
    })

    console.log(`\n📋 WAITING TOKENS (${waitingTokens.length} total):\n`)

    const toLangArray = (val: any): string[] => {
      try {
        if (!val) return []
        if (Array.isArray(val)) return val.filter(v => typeof v === 'string') as string[]
        if (typeof val === 'string') {
          const parsed = JSON.parse(val)
          return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []
        }
        if (typeof val === 'object') {
          return Object.values(val).filter(v => typeof v === 'string') as string[]
        }
      } catch { }
      return []
    }

    const hasAny = (a: string[], b: string[]) => a.some(x => b.includes(x))

    for (const token of waitingTokens) {
      const tokenServices = Array.isArray(token.serviceTypes) ? token.serviceTypes as string[] : []
      const tokenLangs = toLangArray(token.preferredLanguages)

      console.log(`Token #${token.tokenNumber} (${token.outlet?.name || 'Unknown outlet'})`)
      console.log(`   Customer: ${token.customer.name}`)
      console.log(`   Services: ${tokenServices.length > 0 ? tokenServices.join(', ') : '⚠️  NONE'}`)
      console.log(`   Languages: ${tokenLangs.length > 0 ? tokenLangs.join(', ') : '⚠️  NONE'}`)

      // Check for matches
      const outletOfficers = officers.filter(o => o.outletId === token.outletId && ['available', 'serving'].includes(o.status))
      
      if (outletOfficers.length === 0) {
        console.log(`   ❌ NO AVAILABLE OFFICERS in this outlet`)
      } else {
        let foundMatch = false
        const matchingOfficers: string[] = []

        for (const officer of outletOfficers) {
          const officerServices = parseJsonArray(officer.assignedServices)
          const officerLangs = parseJsonArray(officer.languages)

          if (officerServices.length === 0 || officerLangs.length === 0) {
            continue
          }

          const serviceMatch = hasAny(tokenServices, officerServices)
          const langMatch = hasAny(tokenLangs, officerLangs)

          if (serviceMatch && langMatch) {
            foundMatch = true
            matchingOfficers.push(officer.name)
          }
        }

        if (foundMatch) {
          console.log(`   ✅ Can be matched to: ${matchingOfficers.join(', ')}`)
        } else {
          console.log(`   ❌ NO MATCHING OFFICER (no officer has both service AND language match)`)
          
          // Show why
          let hasServiceMatch = false
          let hasLangMatch = false

          for (const officer of outletOfficers) {
            const officerServices = parseJsonArray(officer.assignedServices)
            const officerLangs = parseJsonArray(officer.languages)

            if (hasAny(tokenServices, officerServices)) hasServiceMatch = true
            if (hasAny(tokenLangs, officerLangs)) hasLangMatch = true
          }

          if (!hasServiceMatch) {
            console.log(`      → No officer has service: ${tokenServices.join(', ')}`)
          }
          if (!hasLangMatch) {
            console.log(`      → No officer has language: ${tokenLangs.join(', ')}`)
          }
        }
      }
      console.log()
    }

    console.log('\n=== SUMMARY ===')
    console.log(`Total Officers: ${officers.length}`)
    console.log(`Officers with issues: ${officersWithIssues}`)
    console.log(`Waiting Tokens: ${waitingTokens.length}`)

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

diagnoseUnmatchedTokens()
