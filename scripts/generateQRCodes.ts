import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// QR token generation function
const generateQRToken = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

async function main() {
  console.log("🔄 Generating QR codes for existing outlets...\n")

  // Get all active outlets
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    include: {
      region: true
    }
  })

  if (outlets.length === 0) {
    console.log("❌ No active outlets found. Please run seedOutlets.ts first.")
    return
  }

  console.log(`📍 Found ${outlets.length} active outlets:\n`)

  for (const outlet of outlets) {
    const qrToken = generateQRToken()
    const generatedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    
    console.log(`🏢 ${outlet.name} (${outlet.location})`)
    console.log(`   Outlet ID: ${outlet.id}`)
    console.log(`   QR Token: ${qrToken}`)
    console.log(`   Generated: ${new Date(generatedAt).toLocaleString()}`)
    console.log(`   Expires: ${new Date(expiresAt).toLocaleString()}`)
    console.log(`   Region: ${outlet.region?.name}`)
    
    // Register with backend (simulate the API call)
    try {
      const response = await fetch('http://localhost:3001/api/customer/manager-qr-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          outletId: outlet.id,
          token: qrToken,
          generatedAt
        })
      })

      if (response.ok) {
        console.log(`   ✅ QR code registered with backend`)
      } else {
        console.log(`   ❌ Failed to register QR code with backend: ${response.statusText}`)
      }
    } catch (error) {
      console.log(`   ⚠️  Backend not running - QR code generated but not registered`)
    }
    
    console.log(`   📱 Registration URL: http://localhost:3000/register/${outlet.id}?qr=${qrToken}`)
    console.log(`   🔗 QR Display URL: http://localhost:3000/qr/${outlet.id}`)
    console.log("")
  }

  console.log("✅ QR code generation completed!")
  console.log("\n📋 Summary:")
  console.log(`   - Generated QR codes for ${outlets.length} outlets`)
  console.log(`   - Each QR code expires in 24 hours`)
  console.log(`   - RTOMs can refresh QR codes as needed`)
  console.log(`   - QR codes are automatically generated when new outlets are created`)
}

main()
  .catch((e) => {
    console.error("❌ Error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })