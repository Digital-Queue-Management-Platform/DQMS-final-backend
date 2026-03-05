/**
 * Script to set display order for services
 * 
 * This script helps you set the order for existing services in the database.
 * Run this script to assign order values to your services.
 * 
 * Usage: 
 *   npx ts-node scripts/setServiceOrder.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function setServiceOrder() {
  try {
    console.log('Setting service display order...\n')

    // Define your desired service order here
    // Format: { code: 'SVC001', order: 1 }
    const serviceOrders = [
      { code: 'SVC001', order: 1 },
      { code: 'SVC002', order: 2 },  // Bill Payment
      { code: 'SVC003', order: 3 },
      // Add more service codes as needed
    ]

    for (const { code, order } of serviceOrders) {
      const result = await prisma.$executeRaw`
        UPDATE "Service" SET "order" = ${order} WHERE "code" = ${code}
      `
      
      if (result > 0) {
        console.log(`✓ Set order ${order} for service ${code}`)
      } else {
        console.log(`⚠ Service ${code} not found, skipping...`)
      }
    }

    // Show final service list
    console.log('\nCurrent service order:')
    const services = await prisma.$queryRaw<Array<{code: string, title: string, order: number}>>`
      SELECT "code", "title", "order" 
      FROM "Service" 
      ORDER BY "order" ASC, "createdAt" ASC
    `
    
    services.forEach(s => {
      console.log(`  ${s.order}: ${s.code} - ${s.title}`)
    })

    console.log('\n✓ Service order updated successfully!')
  } catch (error) {
    console.error('Error setting service order:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

setServiceOrder()
