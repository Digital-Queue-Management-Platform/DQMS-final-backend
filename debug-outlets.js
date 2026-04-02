const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugOutlets() {
  try {
    console.log('=== ALL OUTLETS ===');
    const allOutlets = await prisma.outlet.findMany({
      include: {
        region: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    console.log(`Total outlets found: ${allOutlets.length}`);
    allOutlets.forEach(outlet => {
      console.log(`- ${outlet.name} (ID: ${outlet.id}) in ${outlet.region?.name || 'No Region'} (RegionID: ${outlet.regionId}) - Active: ${outlet.isActive}`);
    });

    console.log('\n=== ALL RTOMS ===');
    const allRtoms = await prisma.rTOM.findMany({
      include: {
        region: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    console.log(`Total RTOMs found: ${allRtoms.length}`);
    allRtoms.forEach(rtom => {
      console.log(`- ${rtom.name} (${rtom.mobileNumber}) in ${rtom.region?.name || 'No Region'} (RegionID: ${rtom.regionId})`);
    });

    console.log('\n=== ALL REGIONS ===');
    const allRegions = await prisma.region.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            outlets: true
          }
        }
      }
    });
    
    allRegions.forEach(region => {
      console.log(`- ${region.name} (ID: ${region.id}) - ${region._count.outlets} outlets`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugOutlets();