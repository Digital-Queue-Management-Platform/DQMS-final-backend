import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

/**
 * Device Removal Test Utility
 * Tests the device removal functionality for outlet displays
 */

async function testDeviceRemoval() {
  console.log("🧪 Device Removal Test Suite\n")

  // Find outlets with configured devices
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    select: { id: true, name: true, displaySettings: true }
  })

  const outletsWithDevices = outlets.filter(outlet => {
    const settings = outlet.displaySettings as any || {}
    const devices = settings.linkedDevices || []
    return devices.length > 0
  })

  if (outletsWithDevices.length === 0) {
    console.log("❌ No outlets have configured devices to test removal")
    return
  }

  console.log(`🎯 Found ${outletsWithDevices.length} outlets with configured devices:\n`)

  for (const outlet of outletsWithDevices) {
    console.log(`🏢 ${outlet.name} (${outlet.id})`)
    
    const settings = outlet.displaySettings as any || {}
    const devices = settings.linkedDevices || []
    
    console.log(`   📱 Configured Devices: ${devices.length}`)
    
    devices.forEach((device: any, index: number) => {
      console.log(`   ${index + 1}. Device Name: ${device.deviceName}`)
      console.log(`      Device ID: ${device.deviceId}`)
      console.log(`      Status: ${device.isActive ? 'Active' : 'Inactive'}`)
      console.log(`      Configured: ${device.configuredAt}`)
      console.log(`      Last Seen: ${device.lastSeen}`)
      
      if (device.setupCode) {
        console.log(`      Setup Code Used: ${device.setupCode}`)
      }
    })
    
    console.log("")
  }

  console.log("📋 Device Removal Test Instructions:")
  console.log("1. Use the teleshop manager dashboard")
  console.log("2. Click 'Release Device' for any device listed above")
  console.log("3. Expected behavior:")
  console.log("   ✅ Device should be removed from outlet displaySettings")
  console.log("   ✅ WebSocket broadcast should be sent with 'resetToQR: true'")
  console.log("   ✅ APK should receive broadcast and reset to QR display")
  console.log("   ✅ Device should no longer appear in configured devices list")
  console.log("")
  console.log("4. To verify removal worked:")
  console.log("   - Run this script again")
  console.log("   - Check that device is no longer listed")
  console.log("   - Verify APK shows QR code for reconfiguration")
}

async function main() {
  try {
    await testDeviceRemoval()
  } catch (error) {
    console.error("❌ Test error:", error)
  }
}

main()
  .catch((e) => {
    console.error("❌ Error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })