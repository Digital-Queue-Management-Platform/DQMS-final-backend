interface TestConfig {
  centralServerUrl: string
  vlcHost: string
  vlcPort: number
  vlcPassword: string
  branchId: string
}

const config: TestConfig = {
  centralServerUrl: process.env.CENTRAL_ANNOUNCEMENT_SERVER || 'http://localhost:3002',
  vlcHost: process.env.VLC_HOST || 'localhost',
  vlcPort: parseInt(process.env.VLC_PORT || '8081'),
  vlcPassword: process.env.VLC_PASSWORD || '',
  branchId: process.env.DEFAULT_BRANCH_ID || 'test-branch'
}

async function testVLCConnection() {
  console.log('🧪 Testing VLC HTTP Interface...')
  
  try {
    const vlcUrl = `http://${config.vlcHost}:${config.vlcPort}/requests/status.json`
    const authHeader = config.vlcPassword ? 
      `Basic ${Buffer.from(`:${config.vlcPassword}`).toString('base64')}` : 
      undefined

    const response = await fetch(vlcUrl, {
      method: 'GET',
      headers: {
        ...(authHeader && { 'Authorization': authHeader })
      }
    })

    if (response.ok) {
      const data = await response.json() as any
      console.log('✅ VLC Connection: Success')
      console.log(`   Status: ${data.state || 'Unknown'}`)
      console.log(`   Version: ${data.version || 'Unknown'}`)
      console.log(`   Volume: ${data.volume || 'Unknown'}`)
      return true
    } else {
      console.log(`❌ VLC Connection Failed: ${response.status} ${response.statusText}`)
      return false
    }
  } catch (error) {
    console.log(`❌ VLC Connection Error: ${error}`)
    console.log('   Make sure VLC is running with HTTP interface:')
    console.log(`   vlc --intf http --http-password ${config.vlcPassword} --http-port ${config.vlcPort}`)
    return false
  }
}

async function testCentralServer() {
  console.log('🧪 Testing Central Announcement Server...')
  
  try {
    const response = await fetch(`${config.centralServerUrl}/api/health`)
    
    if (response.ok) {
      const data = await response.json() as any
      console.log('✅ Central Server: Healthy')
      console.log(`   Total Branches: ${data.totalBranches || 0}`)
      console.log(`   Server Port: ${data.server?.port || 'Unknown'}`)
      console.log(`   WebSocket Port: ${data.server?.wsPort || 'Unknown'}`)
      console.log(`   Uptime: ${Math.round(data.server?.uptime || 0)}s`)
      return true
    } else {
      console.log(`❌ Central Server Failed: ${response.status} ${response.statusText}`)
      return false
    }
  } catch (error) {
    console.log(`❌ Central Server Error: ${error}`)
    console.log('   Make sure central server is running:')
    console.log('   npm run dev:central-server')
    return false
  }
}

async function testAnnouncement() {
  console.log('🧪 Testing Announcement Flow...')
  
  try {
    const announcement = {
      branchId: config.branchId,
      counterId: 'test-counter',
      text: 'Test announcement: Token number 999, please proceed to counter 1',
      language: 'en',
      volume: 50,
      tokenNumber: 999
    }

    const response = await fetch(`${config.centralServerUrl}/api/announce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(announcement)
    })

    if (response.ok) {
      const data = await response.json() as any
      console.log('✅ Announcement: Success')
      console.log(`   Message: ${data.message}`)
      console.log(`   Success Count: ${data.successCount || 0}`)
      console.log(`   Audio URL: ${data.audioUrl || 'N/A'}`)
      return true
    } else {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as any
      console.log(`❌ Announcement Failed: ${response.status}`)
      console.log(`   Error: ${errorData.error || errorData.message || 'Unknown'}`)
      return false
    }
  } catch (error) {
    console.log(`❌ Announcement Error: ${error}`)
    return false
  }
}

async function testBackendAPI() {
  console.log('🧪 Testing Backend API Integration...')
  
  try {
    const response = await fetch('http://localhost:3001/api/ip-speaker/central/status')
    
    if (response.ok) {
      const data = await response.json() as any
      console.log('✅ Backend API: Success')
      console.log(`   Central Server Status: ${data.centralServer?.status || 'Unknown'}`)
      console.log(`   Total Branches: ${data.totalBranches || 0}`)
      return true
    } else {
      console.log(`❌ Backend API Failed: ${response.status}`)
      return false
    }
  } catch (error) {
    console.log(`❌ Backend API Error: ${error}`)
    console.log('   Make sure main backend server is running:')
    console.log('   npm run dev')
    return false
  }
}

async function runAllTests() {
  console.log('🚀 DQMS Central Speaker System Test Suite')
  console.log('=' .repeat(50))
  console.log(`Configuration:`)
  console.log(`   Central Server: ${config.centralServerUrl}`)
  console.log(`   VLC: http://${config.vlcHost}:${config.vlcPort}`)
  console.log(`   Branch ID: ${config.branchId}`)
  console.log('=' .repeat(50))

  const results = {
    vlc: await testVLCConnection(),
    centralServer: await testCentralServer(),
    announcement: false,
    backendAPI: false
  }

  console.log()

  if (results.centralServer) {
    results.announcement = await testAnnouncement()
  }

  console.log()

  results.backendAPI = await testBackendAPI()

  console.log()
  console.log('📊 Test Results Summary:')
  console.log('=' .repeat(50))
  console.log(`VLC Connection:      ${results.vlc ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Central Server:      ${results.centralServer ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Announcement:        ${results.announcement ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`Backend API:         ${results.backendAPI ? '✅ PASS' : '❌ FAIL'}`)

  const passCount = Object.values(results).filter(Boolean).length
  const totalTests = Object.keys(results).length

  console.log()
  console.log(`Overall: ${passCount}/${totalTests} tests passed`)

  if (passCount === totalTests) {
    console.log('🎉 All tests passed! The system is ready to use.')
  } else {
    console.log('⚠️  Some tests failed. Please check the setup instructions.')
  }

  return passCount === totalTests
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1)
    })
    .catch(error => {
      console.error('🚨 Test suite failed:', error)
      process.exit(1)
    })
}

export { runAllTests, testVLCConnection, testCentralServer, testAnnouncement, testBackendAPI }