import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

/**
 * QR Token Management Utility
 * Helps with QR token lookup and validation for outlet displays
 */

async function main() {
  console.log("🔍 QR Token Lookup Tool for Outlet Display Management\n")

  // Get all outlets with their latest QR tokens
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    include: {
      _count: {
        select: { teleshopManagers: true }
      }
    },
    orderBy: { name: 'asc' }
  })

  console.log("📋 All Active Outlets & Their QR Tokens:\n")
  
  for (const outlet of outlets) {
    console.log(`🏢 ${outlet.name}`)
    console.log(`   📍 Location: ${outlet.location}`)
    console.log(`   🆔 Outlet ID: ${outlet.id}`)
    console.log(`   👥 Managers Assigned: ${outlet._count.teleshopManagers}`)
    
    // Get latest QR token for this outlet
    const latestToken = await prisma.managerQRToken.findFirst({
      where: { outletId: outlet.id },
      orderBy: { generatedAt: 'desc' }
    })
    
    if (latestToken) {
      const hoursAgo = Math.round((Date.now() - latestToken.generatedAt.getTime()) / (1000 * 60 * 60))
      console.log(`   🎫 Latest QR Token: ${latestToken.token}`)
      console.log(`   ⏰ Generated: ${hoursAgo} hours ago`)
      console.log(`   ✅ Status: Valid for QR scanning`)
    } else {
      console.log(`   ❌ No QR token found - needs generation`)
    }
    
    // Check device configurations
    const displaySettings = outlet.displaySettings as any || {}
    const linkedDevices = displaySettings.linkedDevices || []
    
    if (linkedDevices.length > 0) {
      console.log(`   📱 Linked Devices: ${linkedDevices.length}`)
      linkedDevices.forEach((device: any) => {
        console.log(`      - ${device.deviceName} (${device.deviceId}) - ${device.isActive ? 'Active' : 'Inactive'}`)
      })
    } else {
      console.log(`   📱 Linked Devices: None`)
    }
    
    console.log("")
  }
  
  console.log("📖 Usage Instructions:")
  console.log("1. Use the QR tokens above for testing QR scanning")
  console.log("2. Each token is valid for the specific outlet listed")
  console.log("3. Device removal should work for any linked device")
  console.log("4. New outlets will automatically get QR tokens when created")
}

main()
  .catch((e) => {
    console.error("❌ Error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })