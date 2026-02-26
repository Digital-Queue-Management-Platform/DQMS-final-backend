/**
 * Test script for SLT Billing API Integration
 * 
 * This script tests the integration with the real SLT billing API
 * 
 * Usage:
 *   npx tsx scripts/testSltBilling.ts
 */

import { PrismaClient } from '@prisma/client';
import { fetchBillFromSltApi, normalizeSltBillData } from '../src/services/sltBillingService';

const prisma = new PrismaClient();

async function testSltBillingIntegration() {
  console.log('🧪 Testing SLT Billing API Integration\n');

  // Test telephone numbers (replace with real test numbers)
  const testNumbers = [
    '0112123456', // Example number from API docs
    // Add more test numbers here
  ];

  for (const telephoneNumber of testNumbers) {
    console.log(`\n📞 Testing telephone number: ${telephoneNumber}`);
    console.log('─'.repeat(60));

    try {
      // Step 1: Fetch from SLT API
      console.log('Step 1: Fetching from SLT API...');
      const billInfo = await fetchBillFromSltApi(telephoneNumber);
      console.log('✅ SLT API Response:', JSON.stringify(billInfo, null, 2));

      // Step 2: Normalize data
      console.log('\nStep 2: Normalizing data...');
      const normalizedData = normalizeSltBillData(billInfo, telephoneNumber);
      console.log('✅ Normalized Data:', JSON.stringify(normalizedData, null, 2));

      // Step 3: Save to database (upsert)
      console.log('\nStep 3: Saving to database...');
      const savedBill = await prisma.sltBill.upsert({
        where: { telephoneNumber },
        update: {
          ...normalizedData,
          updatedAt: new Date(),
        },
        create: {
          ...normalizedData,
        },
      });
      console.log('✅ Saved to database:', savedBill.id);

      // Step 4: Retrieve from database
      console.log('\nStep 4: Retrieving from database...');
      const retrievedBill = await prisma.sltBill.findUnique({
        where: { telephoneNumber },
      });
      console.log('✅ Retrieved from database:', JSON.stringify(retrievedBill, null, 2));

      console.log('\n✅ Test PASSED for', telephoneNumber);

    } catch (error: any) {
      console.error('❌ Test FAILED for', telephoneNumber);
      console.error('Error:', error.message);
      
      // Check if cached data exists
      console.log('\nChecking for cached data...');
      const cachedBill = await prisma.sltBill.findUnique({
        where: { telephoneNumber },
      });
      
      if (cachedBill) {
        console.log('ℹ️  Cached data found:', JSON.stringify(cachedBill, null, 2));
      } else {
        console.log('ℹ️  No cached data available');
      }
    }

    console.log('─'.repeat(60));
  }

  console.log('\n\n📊 Summary:');
  const totalBills = await prisma.sltBill.count();
  console.log(`Total bills in database: ${totalBills}`);

  // Show recent bills
  const recentBills = await prisma.sltBill.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: {
      telephoneNumber: true,
      accountName: true,
      currentBill: true,
      status: true,
      updatedAt: true,
    }
  });

  console.log('\nRecent bills:');
  console.table(recentBills);
}

// Run the test
testSltBillingIntegration()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
