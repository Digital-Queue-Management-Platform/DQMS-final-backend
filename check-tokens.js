const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkTokens() {
  console.log('🔍 Checking existing tokens in database...\n');
  
  try {
    // Get a few recent tokens to test with
    const tokens = await prisma.token.findMany({
      include: {
        customer: true,
        outlet: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    if (tokens.length === 0) {
      console.log('❌ No tokens found in database');
      console.log('💡 Try registering a customer first at http://localhost:3000/register/{outletId}');
      return;
    }

    console.log(`✅ Found ${tokens.length} recent tokens:\n`);
    
    tokens.forEach((token, index) => {
      const shortId = token.id.substring(0, 8);
      console.log(`${index + 1}. Token ID: ${token.id}`);
      console.log(`   Short ID: ${shortId}`);
      console.log(`   Customer: ${token.customer.name} (${token.customer.mobileNumber})`);
      console.log(`   Outlet: ${token.outlet?.name || 'Unknown'}`);
      console.log(`   Status: ${token.status}`);
      console.log(`   Token #: ${token.tokenNumber}`);
      console.log(`   Test URL: http://localhost:3001/customer/t/${shortId}`);
      console.log(`   Frontend URL: http://localhost:3000/t/${shortId}`);
      console.log('');
    });
    
    // Test the first token ID
    if (tokens[0]) {
      const testShortId = tokens[0].id.substring(0, 8);
      console.log(`🧪 Testing backend API with: http://localhost:3001/customer/t/${testShortId}`);
      
      try {
        const response = await fetch(`http://localhost:3001/customer/t/${testShortId}`);
        const data = await response.json();
        
        if (response.ok) {
          console.log('✅ Backend API working! Response:');
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log('❌ Backend API error:', data);
        }
      } catch (error) {
        console.log('❌ Failed to test backend API:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Database error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTokens();