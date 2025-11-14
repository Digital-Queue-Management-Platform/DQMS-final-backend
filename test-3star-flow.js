const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

const API_BASE = 'http://localhost:3001/api';

async function testThreeStarRating() {
  try {
    console.log('🧪 Testing 3-Star Rating Flow...\n');

    // Step 1: Create a new token for testing
    console.log('📋 Step 1: Creating a test token...');
    
    const customer = await prisma.customer.findFirst();
    const officer = await prisma.officer.findFirst({
      where: {
        teleshopManagerId: { not: null }
      },
      include: {
        teleshopManager: true
      }
    });
    const outlet = await prisma.outlet.findFirst();

    if (!customer || !officer || !outlet) {
      console.log('❌ Missing required data (customer/officer/outlet)');
      return;
    }

    // Create a test token
    const testToken = await prisma.token.create({
      data: {
        tokenNumber: Math.floor(Math.random() * 9000) + 1000, // Random 4-digit number
        customerId: customer.id,
        outletId: outlet.id,
        assignedTo: officer.id,
        serviceTypes: ['SERVICE_001'], // Mock service type
        status: 'completed',
        completedAt: new Date()
      }
    });

    console.log(`✅ Created test token ${testToken.tokenNumber} assigned to ${officer.name} (TM: ${officer.teleshopManager.name})`);

    // Step 2: Submit 3-star feedback
    console.log('\n⭐ Step 2: Submitting 3-star feedback...');
    
    const feedbackResponse = await axios.post(`${API_BASE}/feedback/submit`, {
      tokenId: testToken.id,
      rating: 3,
      comment: 'Test 3-star feedback to verify teleshop manager notifications'
    });

    console.log('✅ Feedback submitted:', feedbackResponse.data.success ? 'SUCCESS' : 'FAILED');

    // Step 3: Check if alert was created
    console.log('\n🔔 Step 3: Checking if alert was created...');
    
    const newAlerts = await prisma.alert.findMany({
      where: {
        type: 'moderate_feedback',
        relatedEntity: testToken.id
      }
    });

    console.log(`📬 Found ${newAlerts.length} new alert(s) for this token`);
    if (newAlerts.length > 0) {
      newAlerts.forEach(alert => {
        console.log(`   🔔 Alert: ${alert.message}`);
        console.log(`   📅 Created: ${alert.createdAt}`);
        console.log(`   👁️ Read: ${alert.isRead}`);
      });
    }

    // Step 4: Check if feedback was properly assigned
    console.log('\n📝 Step 4: Checking feedback assignment...');
    
    const feedback = await prisma.feedback.findFirst({
      where: {
        tokenId: testToken.id
      }
    });

    if (feedback) {
      console.log(`✅ Feedback found:`);
      console.log(`   ⭐ Rating: ${feedback.rating}`);
      console.log(`   🎯 Assigned to: ${feedback.assignedTo}`);
      console.log(`   🆔 Assigned to ID: ${feedback.assignedToId}`);
      console.log(`   ✅ Resolved: ${feedback.isResolved}`);
    } else {
      console.log('❌ No feedback found for the token');
    }

    console.log('\n🧪 Test completed! Check the frontend teleshop manager dashboard and feedback page to verify notifications.');
    console.log('💡 The notification bell should show an unread count and the feedback should appear in the feedback management page.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testThreeStarRating();