const { PrismaClient } = require('@prisma/client');
const { getLastDailyReset } = require('./dist/utils/resetWindow');

const prisma = new PrismaClient();

async function checkQueue() {
  try {
    const lastReset = getLastDailyReset();
    console.log('Daily reset time:', lastReset);
    
    // Get all tokens for the outlet since daily reset
    const allTokens = await prisma.token.findMany({
      where: {
        createdAt: { gte: lastReset },
        outletId: 'a0a17cc9-b438-46cf-a336-71f651444dc1' // Matara HQ
      },
      orderBy: { tokenNumber: 'asc' },
      include: { customer: true }
    });
    
    console.log('\nAll tokens since daily reset:');
    allTokens.forEach(token => {
      console.log(`Token #${token.tokenNumber} - ${token.customer.name} - Status: ${token.status}`);
    });
    
    // Get waiting tokens
    const waitingTokens = await prisma.token.findMany({
      where: {
        createdAt: { gte: lastReset },
        outletId: 'a0a17cc9-b438-46cf-a336-71f651444dc1',
        status: 'waiting'
      },
      orderBy: { tokenNumber: 'asc' }
    });
    
    console.log('\nCurrently waiting tokens:');
    waitingTokens.forEach(token => {
      console.log(`Token #${token.tokenNumber}`);
    });
    
    // Calculate position for token 10
    const token10Position = await prisma.token.count({
      where: {
        outletId: 'a0a17cc9-b438-46cf-a336-71f651444dc1',
        status: 'waiting',
        tokenNumber: { lt: 10 },
        createdAt: { gte: lastReset }
      }
    }) + 1;
    
    console.log(`\nToken #10 calculated position: ${token10Position}`);
    
    // Check what tokens are being counted for position calculation
    const tokensBeforeToken10 = await prisma.token.findMany({
      where: {
        outletId: 'a0a17cc9-b438-46cf-a336-71f651444dc1',
        status: 'waiting',
        tokenNumber: { lt: 10 },
        createdAt: { gte: lastReset }
      },
      orderBy: { tokenNumber: 'asc' },
      include: { customer: true }
    });
    
    console.log('\nTokens being counted before token #10:');
    tokensBeforeToken10.forEach(token => {
      console.log(`Token #${token.tokenNumber} - ${token.customer.name} - Status: ${token.status}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkQueue();