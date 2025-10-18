import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function createTestTokensWithLanguages() {
  console.log('Creating test tokens with different language preferences...')

  try {
    // Get the first outlet for testing
    const outlet = await prisma.outlet.findFirst()
    if (!outlet) {
      console.error('No outlets found. Please create an outlet first.')
      return
    }

    // Create test customers with different language preferences
    const testTokens = [
      {
        customerName: 'John Smith',
        mobile: '0771234567',
        language: 'en',
        languageName: 'English'
      },
      {
        customerName: 'රමේෂ් සිල්වා',
        mobile: '0772345678', 
        language: 'si',
        languageName: 'Sinhala'
      },
      {
        customerName: 'குமார் முத்து',
        mobile: '0773456789',
        language: 'ta', 
        languageName: 'Tamil'
      }
    ]

    // Get the highest token number for this outlet
    const lastToken = await prisma.token.findFirst({
      where: { outletId: outlet.id },
      orderBy: { tokenNumber: 'desc' }
    })
    
    let tokenNumber = (lastToken?.tokenNumber || 0) + 1

    for (const testData of testTokens) {
      // Create or find customer
      let customer = await prisma.customer.findFirst({
        where: { mobileNumber: testData.mobile }
      })

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            name: testData.customerName,
            mobileNumber: testData.mobile
          }
        })
      }

      // Create token with language preference
      const token = await prisma.token.create({
        data: {
          tokenNumber,
          customerId: customer.id,
          serviceType: 'bill_payment',
          outletId: outlet.id,
          status: 'waiting',
          preferredLanguages: JSON.stringify([testData.language])
        },
        include: {
          customer: true,
          outlet: true
        }
      })

      console.log(`✅ Created Token #${token.tokenNumber} for ${testData.customerName} with ${testData.languageName} preference`)
      tokenNumber++
    }

    console.log('\n📢 Test tokens created! You can now:')
    console.log('1. Go to the Officer Dashboard')
    console.log('2. Click "Manage Queue" to see the new tokens')
    console.log('3. Call next customer to see the IP Speaker with language-specific announcements')
    console.log('4. Test the text-to-speech functionality in different languages')

  } catch (error) {
    console.error('Error creating test tokens:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createTestTokensWithLanguages()