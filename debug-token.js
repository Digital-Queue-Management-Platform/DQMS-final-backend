const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

// This should match the JWT_SECRET from your backend
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

async function debugToken() {
  try {
    // Get the RTOM from database
    const rtom = await prisma.rTOM.findFirst({
      where: { mobileNumber: '0704133303' },
      include: { region: true }
    });
    
    console.log('RTOM in database:', {
      id: rtom?.id,
      name: rtom?.name,
      mobile: rtom?.mobileNumber,
      regionId: rtom?.regionId,
      regionName: rtom?.region?.name
    });
    
    // Generate a test token for this RTOM
    const testToken = jwt.sign(
      { mobileNumber: rtom.mobileNumber },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('Generated test token:', testToken);
    
    // Try to verify the token
    const decoded = jwt.verify(testToken, JWT_SECRET);
    console.log('Decoded token:', decoded);
    
    // Test the outlets query
    const outlets = await prisma.outlet.findMany({
      where: {
        regionId: rtom.region.id,
        isActive: true,
      },
      include: {
        officers: {
          select: {
            id: true,
            name: true,
            status: true,
            counterNumber: true
          }
        },
        _count: {
          select: {
            tokens: {
              where: {
                createdAt: {
                  gte: new Date(new Date().setHours(0, 0, 0, 0))
                }
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    console.log(`Found ${outlets.length} outlets for region ${rtom.region.name} (${rtom.region.id})`);
    outlets.forEach(outlet => {
      console.log(`- ${outlet.name} (${outlet.id}) - Active: ${outlet.isActive}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugToken();