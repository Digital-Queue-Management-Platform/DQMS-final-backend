const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixTestData() {
  try {
    console.log('🔧 Fixing test data for 3-star rating testing...\n');

    // Get the teleshop manager
    const teleshopManager = await prisma.teleshopManager.findFirst();
    if (!teleshopManager) {
      console.log('❌ No teleshop manager found!');
      return;
    }

    console.log(`📋 Found Teleshop Manager: ${teleshopManager.name}`);

    // Get officers that aren't assigned to a teleshop manager
    const unassignedOfficers = await prisma.officer.findMany({
      where: { 
        teleshopManagerId: null 
      },
      select: {
        id: true,
        name: true,
        outlet: { select: { name: true } }
      }
    });

    if (unassignedOfficers.length > 0) {
      console.log(`\n🔗 Assigning ${unassignedOfficers.length} officers to teleshop manager...`);
      
      // Assign all unassigned officers to the teleshop manager
      const updateResult = await prisma.officer.updateMany({
        where: { 
          teleshopManagerId: null 
        },
        data: {
          teleshopManagerId: teleshopManager.id
        }
      });

      console.log(`✅ Updated ${updateResult.count} officers`);

      // Also fix the existing 3-star feedback assignment
      const existingFeedback = await prisma.feedback.findMany({
        where: {
          rating: 3,
          assignedTo: 'teleshop_manager',
          assignedToId: null
        }
      });

      if (existingFeedback.length > 0) {
        console.log(`\n🔧 Fixing ${existingFeedback.length} 3-star feedback assignments...`);
        
        await prisma.feedback.updateMany({
          where: {
            rating: 3,
            assignedTo: 'teleshop_manager',
            assignedToId: null
          },
          data: {
            assignedToId: teleshopManager.id
          }
        });

        console.log('✅ Fixed 3-star feedback assignments');
      }
    } else {
      console.log('✅ All officers are already assigned to teleshop managers');
    }

    console.log('\n🎯 Test data is now ready for 3-star rating testing!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixTestData();