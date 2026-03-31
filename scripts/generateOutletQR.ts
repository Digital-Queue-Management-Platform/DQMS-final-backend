import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generateQRForOutlet() {
  try {
    const outletId = '8a3ffd36-2853-4b7f-bdd1-7f59fbc1cd9b'; // Teleshop Matara
    
    // Generate a fresh QR token for this outlet (simulating what APK does)
    function generateSetupCode(): string {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const part1 = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const part2 = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      return `${part1}-${part2}`;
    }
    
    const newToken = generateSetupCode();
    
    console.log('Generated new token:', newToken);
    
    // Register it in the database
    const tokenRecord = await prisma.managerQRToken.create({
      data: {
        token: newToken,
        outletId: outletId,
        generatedAt: new Date()
      }
    });
    
    console.log('Registered token:', tokenRecord);
    console.log('\n🎯 Use this token in your teleshop manager APK:', newToken);
    
    // Also show current tokens for this outlet
    const allTokens = await prisma.managerQRToken.findMany({
      where: { outletId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    console.log('\nRecent tokens for Teleshop Matara:');
    allTokens.forEach((token, index) => {
      console.log(`${index + 1}. ${token.token} (${token.createdAt.toISOString()})`);
    });
    
  } catch (error: any) {
    console.error('Error:', error);
    if (error.code === 'P2002') {
      console.log('Token already exists - generating another one...');
      // If collision, try once more
      generateQRForOutlet();
    }
  } finally {
    await prisma.$disconnect();
  }
}

generateQRForOutlet();