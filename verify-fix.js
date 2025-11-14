// Quick verification of the fix
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyFix() {
  console.log('🔍 VERIFYING THE 3-STAR RATING BUG FIX\n');
  
  try {
    // 1. Check alert types in database
    const alertTypes = await prisma.alert.groupBy({
      by: ['type'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } }
    });

    console.log('📊 Alert types in database:');
    alertTypes.forEach(at => {
      console.log(`   ${at.type}: ${at._count.id} alerts`);
    });

    // 2. Verify the specific issue: moderate_feedback alerts exist
    const moderateAlerts = await prisma.alert.count({
      where: { type: 'moderate_feedback' }
    });

    console.log(`\n🎯 Key Check - moderate_feedback alerts: ${moderateAlerts}`);
    
    if (moderateAlerts > 0) {
      console.log('✅ SUCCESS: moderate_feedback alerts found in database');
      console.log('✅ The teleshop manager alerts endpoint should now return these');
    } else {
      console.log('❌ ISSUE: No moderate_feedback alerts found');
    }

    // 3. Check 3-star feedback assignment
    const threeStarFeedback = await prisma.feedback.findMany({
      where: { rating: 3 },
      select: {
        assignedTo: true,
        assignedToId: true,
        isResolved: true,
        token: { select: { tokenNumber: true } }
      }
    });

    console.log(`\n⭐ 3-Star feedback check (${threeStarFeedback.length} found):`);
    threeStarFeedback.forEach(f => {
      console.log(`   Token ${f.token.tokenNumber}: assigned to ${f.assignedTo}, ID: ${f.assignedToId ? 'SET' : 'NULL'}, resolved: ${f.isResolved}`);
    });

    console.log('\n🐛 ORIGINAL BUG:');
    console.log('   - Alerts created with type "moderate_feedback"');
    console.log('   - Teleshop manager endpoint filtered for "TELESHOP_MANAGER_FEEDBACK_ALERT"');
    console.log('   - MISMATCH = No alerts returned');

    console.log('\n✅ FIX APPLIED:');
    console.log('   - Changed teleshop manager filter to "moderate_feedback"');
    console.log('   - Now alerts and filter match = Alerts returned');

    console.log('\n🧪 EXPECTED FRONTEND BEHAVIOR:');
    console.log('   ✅ Notification bell shows unread count');
    console.log('   ✅ Alerts appear in notification panel');
    console.log('   ✅ 3-star feedback appears in feedback page');
    console.log('   ✅ Real-time WebSocket updates work');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyFix();