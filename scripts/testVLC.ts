/**
 * Simple VLC HTTP Interface Test Script
 * 
 * This script tests the VLC HTTP interface for the DQMS Central Speaker System.
 * Run this script to verify VLC is properly configured.
 */

console.log('🧪 VLC HTTP Interface Test')
console.log('=' .repeat(40))

// Configuration
const VLC_HOST = 'localhost'
const VLC_PORT = 8081
const VLC_PASSWORD = 'vlcpassword' // Change this to your VLC password

async function testVLC() {
  try {
    const vlcUrl = `http://${VLC_HOST}:${VLC_PORT}/requests/status.json`
    const authHeader = VLC_PASSWORD ? 
      `Basic ${Buffer.from(`:${VLC_PASSWORD}`).toString('base64')}` : 
      undefined

    console.log(`Testing VLC at: ${vlcUrl}`)
    
    const response = await fetch(vlcUrl, {
      method: 'GET',
      headers: {
        ...(authHeader && { 'Authorization': authHeader })
      }
    })

    if (response.ok) {
      const data = await response.json() as any
      console.log('✅ VLC Connection: Success')
      console.log(`   State: ${data.state || 'Unknown'}`)
      console.log(`   Volume: ${data.volume || 'Unknown'}`)
      console.log(`   Time: ${data.time || 0}s`)
      console.log(`   Length: ${data.length || 0}s`)
      
      // Test volume control
      console.log('\n🔊 Testing volume control...')
      const volumeResponse = await fetch(`${vlcUrl}?command=volume&val=256`, {
        headers: { ...(authHeader && { 'Authorization': authHeader }) }
      })
      
      if (volumeResponse.ok) {
        console.log('✅ Volume control: Success')
      } else {
        console.log('❌ Volume control: Failed')
      }
      
      return true
    } else {
      console.log(`❌ VLC Connection Failed: ${response.status} ${response.statusText}`)
      console.log('\n💡 Setup Instructions:')
      console.log('   1. Make sure VLC is installed')
      console.log('   2. Start VLC with HTTP interface:')
      console.log(`      vlc --intf http --http-password ${VLC_PASSWORD} --http-port ${VLC_PORT}`)
      console.log('   3. Or enable HTTP interface in VLC preferences')
      return false
    }
  } catch (error) {
    console.log(`❌ VLC Connection Error: ${error}`)
    console.log('\n💡 Troubleshooting:')
    console.log('   - Check if VLC is running')
    console.log('   - Verify the port number')
    console.log('   - Check the password')
    console.log('   - Make sure HTTP interface is enabled')
    return false
  }
}

// Test basic VLC commands
async function testVLCCommands() {
  const vlcUrl = `http://${VLC_HOST}:${VLC_PORT}/requests/status.json`
  const authHeader = VLC_PASSWORD ? 
    `Basic ${Buffer.from(`:${VLC_PASSWORD}`).toString('base64')}` : 
    undefined

  console.log('\n🎮 Testing VLC commands...')
  
  const commands = [
    { name: 'Get Status', cmd: '' },
    { name: 'Set Volume to 50%', cmd: '?command=volume&val=256' },
    { name: 'Clear Playlist', cmd: '?command=pl_empty' },
  ]

  for (const command of commands) {
    try {
      const response = await fetch(`${vlcUrl}${command.cmd}`, {
        headers: { ...(authHeader && { 'Authorization': authHeader }) }
      })
      
      if (response.ok) {
        console.log(`   ✅ ${command.name}: Success`)
      } else {
        console.log(`   ❌ ${command.name}: Failed (${response.status})`)
      }
    } catch (error) {
      console.log(`   ❌ ${command.name}: Error`)
    }
  }
}

// Run the test
testVLC().then(async (success) => {
  if (success) {
    await testVLCCommands()
    console.log('\n🎉 VLC is ready for DQMS Central Speaker System!')
  }
  console.log('\n📚 Next Steps:')
  console.log('   1. Start the Central Announcement Server: npm run dev:central-server')
  console.log('   2. Start the Branch Speaker Client: npm run dev:branch-client')
  console.log('   3. Run the full test suite: npm run test:central-server')
}).catch(error => {
  console.error('Test failed:', error)
})