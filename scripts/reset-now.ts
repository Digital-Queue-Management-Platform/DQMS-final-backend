import { PrismaClient } from '@prisma/client'
import { getLastDailyReset } from '../src/utils/resetWindow'

const prisma = new PrismaClient()

async function resetNow() {
  try {
    const lastReset = getLastDailyReset()
    console.log(`Current daily reset boundary is: ${lastReset.toLocaleString()}`)
    
    // 1. Shift all tokens created today to yesterday so the queue resets to 0 and token numbers start from 1
    const pastDate = new Date(lastReset.getTime() - 1000) // 1 second before the reset boundary
    
    console.log('Shifting active tokens to previous day to clear current queue...')
    const tokenResult = await prisma.token.updateMany({
      where: {
        createdAt: { gte: lastReset }
      },
      data: {
        createdAt: pastDate,
        // Optionally mark waiting/called tokens as cancelled
        status: 'cancelled'
      }
    })
    console.log(`Tokens shifted: ${tokenResult.count}`)

    // 2. Reset all officers to offline
    console.log('Resetting all officer statuses to offline...')
    const officerResult = await prisma.officer.updateMany({
      where: {
        status: { not: "offline" }
      },
      data: {
        status: "offline"
      }
    })
    console.log(`Officers reset to offline: ${officerResult.count}`)
    
    console.log('✅ System successfully reset!')
  } catch (error) {
    console.error('Error during reset:', error)
  } finally {
    await prisma.$disconnect()
  }
}

resetNow()
