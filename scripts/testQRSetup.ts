import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testQRSetup() {
  try {
    // Current APK token from the error logs
    const setupCode = 'I8RT-5TCK';
    
    console.log('Testing QR setup for token:', setupCode);
    
    // Check if token already exists
    const existingToken = await prisma.managerQRToken.findUnique({
      where: { token: setupCode }
    });
    
    if (existingToken) {
      console.log('Token already exists:', existingToken);
      return;
    }
    
    // Find outlets - check which one needs devices
    const outlets = await prisma.outlet.findMany({
      include: {
        managerQRTokens: true
      }
    });
    
    console.log('Available outlets:');
    outlets.forEach(outlet => {
      console.log(`- ${outlet.name} (${outlet.id}): ${outlet.managerQRTokens.length} tokens`);
    });
    
    // Use the outlet that was shown in teleshop manager: 8a3ffd36-2853-4b7f-bdd1-7f59fbc1cd9b
    const targetOutletId = '8a3ffd36-2853-4b7f-bdd1-7f59fbc1cd9b';
    
    // Auto-register the token
    const newToken = await prisma.managerQRToken.create({
      data: {
        token: setupCode,
        outletId: targetOutletId,
        generatedAt: new Date()
      }
    });
    
    console.log('Auto-registered token:', newToken);
    
  } catch (error: any) {
    console.error('Error:', error);
    if (error.code === 'P2002') {
      console.log('Token already exists (unique constraint)');
    }
  } finally {
    await prisma.$disconnect();
  }
}

testQRSetup();