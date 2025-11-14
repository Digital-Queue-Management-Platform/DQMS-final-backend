const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTestData() {
  try {
    console.log('🔍 Checking available test data...\n');

    // Check teleshop managers
    const teleshopManagers = await prisma.teleshopManager.findMany({
      take: 3,
      select: { 
        id: true, 
        name: true, 
        email: true, 
        mobileNumber: true 
      }
    });

    console.log('=== TELESHOP MANAGERS ===');
    teleshopManagers.forEach(tm => {
      console.log(`📋 ${tm.name} (${tm.email}) - ID: ${tm.id}`);
    });

    // Check recent completed tokens
    const recentTokens = await prisma.token.findMany({
      where: { status: 'completed' },
      take: 5,
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        tokenNumber: true,
        status: true,
        officer: { 
          select: { 
            name: true,
            teleshopManagerId: true
          } 
        },
        outlet: { select: { name: true } },
        feedback: { 
          select: { 
            rating: true, 
            assignedTo: true,
            isResolved: true
          } 
        }
      }
    });

    console.log('\n=== RECENT COMPLETED TOKENS ===');
    recentTokens.forEach(token => {
      const hasManager = token.officer?.teleshopManagerId;
      console.log(`🎫 Token ${token.tokenNumber} - ${token.outlet?.name} - Officer: ${token.officer?.name} - Has TM: ${!!hasManager}`);
      if (token.feedback.length > 0) {
        token.feedback.forEach(f => {
          console.log(`   ⭐ Rating: ${f.rating} - Assigned to: ${f.assignedTo} - Resolved: ${f.isResolved}`);
        });
      } else {
        console.log('   📝 No feedback yet');
      }
    });

    // Check moderate feedback alerts
    const moderateAlerts = await prisma.alert.findMany({
      where: { type: 'moderate_feedback' },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        message: true,
        isRead: true,
        createdAt: true
      }
    });

    console.log('\n=== MODERATE FEEDBACK ALERTS ===');
    if (moderateAlerts.length > 0) {
      moderateAlerts.forEach(alert => {
        console.log(`🔔 ${alert.message} - Read: ${alert.isRead} - ${alert.createdAt.toISOString().split('T')[0]}`);
      });
    } else {
      console.log('🔕 No moderate_feedback alerts found');
    }

    // Check 3-star feedback
    const threeStarFeedback = await prisma.feedback.findMany({
      where: { rating: 3 },
      take: 3,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        rating: true,
        assignedTo: true,
        assignedToId: true,
        isResolved: true,
        token: {
          select: {
            tokenNumber: true,
            outlet: { select: { name: true } }
          }
        }
      }
    });

    console.log('\n=== EXISTING 3-STAR FEEDBACK ===');
    if (threeStarFeedback.length > 0) {
      threeStarFeedback.forEach(f => {
        console.log(`⭐ Token ${f.token.tokenNumber} - ${f.token.outlet.name} - Assigned to: ${f.assignedTo} (ID: ${f.assignedToId}) - Resolved: ${f.isResolved}`);
      });
    } else {
      console.log('🌟 No 3-star feedback found');
    }

    console.log('\n✅ Data check complete!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTestData();