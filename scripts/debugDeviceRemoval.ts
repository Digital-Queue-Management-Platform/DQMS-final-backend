import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

/**
 * Debug Device Removal Issues
 * Tests what might be causing device removal failures
 */

async function debugDeviceRemoval() {
  console.log("🔍 Debug Device Removal Issues\n")

  const deviceId = "f6f280fa5ea1add7" // TX3 device
  const outletId = "8a3ffd36-2853-4b7f-bdd1-7f59fbc1cd9b" // Teleshop Matara
  const managerId = "dd187d8b-78d1-4af5-8d10-db607f7f451d" // Pramodh De Silva

  console.log("Target Details:")
  console.log(`Device ID: ${deviceId}`)
  console.log(`Outlet ID: ${outletId}`)
  console.log(`Manager ID: ${managerId}\n`)

  try {
    // 1. Check if manager exists and is active
    const manager = await prisma.teleshopManager.findUnique({
      where: { id: managerId },
      select: { id: true, name: true, branchId: true, isActive: true }
    })

    if (!manager) {
      console.log("❌ Manager not found!")
      return
    }

    console.log("✅ Manager Check:")
    console.log(`   Name: ${manager.name}`)
    console.log(`   Active: ${manager.isActive}`)
    console.log(`   Branch ID: ${manager.branchId}`)
    console.log(`   Branch matches outlet: ${manager.branchId === outletId}`)

    if (manager.branchId !== outletId) {
      console.log("❌ ISSUE: Manager not assigned to this outlet!")
      return
    }

    // 2. Check if outlet exists
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { id: true, name: true, displaySettings: true }
    })

    if (!outlet) {
      console.log("❌ Outlet not found!")
      return
    }

    console.log("\n✅ Outlet Check:")
    console.log(`   Name: ${outlet.name}`)

    // 3. Check device configuration
    const displaySettings = outlet.displaySettings as any || {}
    const linkedDevices = displaySettings.linkedDevices || []
    
    console.log(`   Linked devices: ${linkedDevices.length}`)
    
    const targetDevice = linkedDevices.find((device: any) => device.deviceId === deviceId)
    
    if (!targetDevice) {
      console.log("❌ ISSUE: Device not found in outlet configuration!")
      console.log("   Available devices:")
      linkedDevices.forEach((device: any, index: number) => {
        console.log(`     ${index + 1}. ${device.deviceName} (${device.deviceId})`)
      })
      return
    }

    console.log("\n✅ Device Check:")
    console.log(`   Found device: ${targetDevice.deviceName}`)
    console.log(`   Device ID matches: ${targetDevice.deviceId === deviceId}`)
    console.log(`   Is active: ${targetDevice.isActive}`)

    // 4. Simulate removal
    console.log("\n🔧 Simulating Removal Process:")
    
    const updatedDevices = linkedDevices.filter((device: any) => device.deviceId !== deviceId)
    console.log(`   Devices before removal: ${linkedDevices.length}`)
    console.log(`   Devices after removal: ${updatedDevices.length}`)
    
    const newDisplaySettings = {
      ...displaySettings,
      linkedDevices: updatedDevices
    }

    // Test the update (but don't actually do it)
    console.log("   New display settings prepared ✅")
    
    console.log("\n🎯 CONCLUSION:")
    console.log("   All checks passed! Device removal should work.")
    console.log("   If removal is still failing, the issue is likely:")
    console.log("   1. Authentication token is invalid/expired")
    console.log("   2. Frontend is not sending correct deviceId")
    console.log("   3. There's a server error during the update")

  } catch (error) {
    console.error("❌ Database error:", error)
  }
}

async function main() {
  try {
    await debugDeviceRemoval()
  } catch (error) {
    console.error("❌ Debug error:", error)
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