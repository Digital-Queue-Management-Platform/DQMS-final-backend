import { prisma } from '../src/server'

async function seedBillPaymentService() {
  try {
    console.log('Checking for Bill Payment service...')

    // Check if Bill Payment service already exists
    const existingService = await prisma.service.findUnique({
      where: { code: 'BILL_PAYMENT' },
    })

    if (existingService) {
      console.log('✅ Bill Payment service already exists:', existingService)
      return
    }

    // Create Bill Payment service
    const billPaymentService = await prisma.service.create({
      data: {
        code: 'BILL_PAYMENT',
        title: 'Bill Payment',
        description: 'Pay SLT bills and account dues',
        isActive: true,
      },
    })

    console.log('✅ Bill Payment service created:', billPaymentService)

    // Fetch all services to confirm
    const allServices = await prisma.service.findMany({
      orderBy: { createdAt: 'desc' },
    })

    console.log('\n📋 All available services:')
    allServices.forEach((service) => {
      console.log(`  - ${service.code}: ${service.title} (Active: ${service.isActive})`)
    })
  } catch (error) {
    console.error('❌ Error seeding Bill Payment service:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

seedBillPaymentService()
