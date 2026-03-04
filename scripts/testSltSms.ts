import axios from 'axios'

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api'

interface TestResult {
  name: string
  success: boolean
  message: string
  details?: any
}

const results: TestResult[] = []

async function testSmsStatus() {
  try {
    const response = await axios.get(`${API_BASE_URL}/slt-sms/status`)
    results.push({
      name: 'SLT SMS Status Check',
      success: response.data.configured,
      message: response.data.configured 
        ? '✅ SLT SMS is properly configured' 
        : '❌ SLT SMS not configured',
      details: response.data
    })
  } catch (error: any) {
    results.push({
      name: 'SLT SMS Status Check',
      success: false,
      message: `❌ Failed: ${error.message}`,
      details: error.response?.data
    })
  }
}

async function testBasicSms(testNumber: string) {
  try {
    const response = await axios.post(`${API_BASE_URL}/slt-sms/test`, {
      to: testNumber,
      message: 'This is a test message from DQMS - SLT SMS Integration Test'
    })
    
    results.push({
      name: 'Basic SMS Test',
      success: response.data.success,
      message: response.data.success 
        ? `✅ SMS sent successfully to ${testNumber}` 
        : '❌ Failed to send SMS',
      details: response.data
    })
  } catch (error: any) {
    results.push({
      name: 'Basic SMS Test',
      success: false,
      message: `❌ Failed: ${error.message}`,
      details: error.response?.data
    })
  }
}

async function testOtpSms(testNumber: string) {
  try {
    const response = await axios.post(`${API_BASE_URL}/slt-sms/send-otp`, {
      to: testNumber,
      otpCode: '1234',
      language: 'en'
    })
    
    results.push({
      name: 'OTP SMS Test',
      success: response.data.success,
      message: response.data.success 
        ? `✅ OTP SMS sent successfully to ${testNumber}` 
        : '❌ Failed to send OTP',
      details: response.data
    })
  } catch (error: any) {
    results.push({
      name: 'OTP SMS Test',
      success: false,
      message: `❌ Failed: ${error.message}`,
      details: error.response?.data
    })
  }
}

async function testAppointmentSms(testNumber: string) {
  try {
    const response = await axios.post(`${API_BASE_URL}/slt-sms/send-appointment`, {
      to: testNumber,
      appointmentDetails: {
        name: 'Test User',
        outletName: 'Colombo Branch',
        dateTime: '2026-03-05 10:00 AM',
        services: 'Bill Payment, New Connection'
      },
      language: 'en'
    })
    
    results.push({
      name: 'Appointment SMS Test',
      success: response.data.success,
      message: response.data.success 
        ? `✅ Appointment SMS sent successfully to ${testNumber}` 
        : '❌ Failed to send appointment confirmation',
      details: response.data
    })
  } catch (error: any) {
    results.push({
      name: 'Appointment SMS Test',
      success: false,
      message: `❌ Failed: ${error.message}`,
      details: error.response?.data
    })
  }
}

async function testTokenReadySms(testNumber: string) {
  try {
    const response = await axios.post(`${API_BASE_URL}/slt-sms/send-token-ready`, {
      to: testNumber,
      tokenNumber: 42,
      counterNumber: 5,
      language: 'en'
    })
    
    results.push({
      name: 'Token Ready SMS Test',
      success: response.data.success,
      message: response.data.success 
        ? `✅ Token notification sent successfully to ${testNumber}` 
        : '❌ Failed to send token notification',
      details: response.data
    })
  } catch (error: any) {
    results.push({
      name: 'Token Ready SMS Test',
      success: false,
      message: `❌ Failed: ${error.message}`,
      details: error.response?.data
    })
  }
}

function printResults() {
  console.log('\n' + '='.repeat(80))
  console.log('SLT SMS INTEGRATION TEST RESULTS')
  console.log('='.repeat(80) + '\n')
  
  let passCount = 0
  let failCount = 0
  
  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.name}`)
    console.log(`   ${result.message}`)
    
    if (result.details) {
      console.log(`   Details:`, JSON.stringify(result.details, null, 2).split('\n').map((line, i) => i === 0 ? line : `            ${line}`).join('\n'))
    }
    
    console.log('')
    
    if (result.success) passCount++
    else failCount++
  })
  
  console.log('='.repeat(80))
  console.log(`SUMMARY: ${passCount} passed, ${failCount} failed out of ${results.length} tests`)
  console.log('='.repeat(80) + '\n')
  
  if (failCount > 0) {
    console.log('⚠️  Some tests failed. Please check:')
    console.log('   1. SLT SMS credentials in .env file')
    console.log('   2. API server is running')
    console.log('   3. Network connectivity to SLT SMS Gateway')
    console.log('   4. Test number is a valid Sri Lankan mobile number\n')
  }
}

async function runTests() {
  const testNumber = process.argv[2] || '0771234567'
  
  console.log('\n📱 Starting SLT SMS Integration Tests...')
  console.log(`📞 Test Number: ${testNumber}`)
  console.log(`🌐 API Base URL: ${API_BASE_URL}\n`)
  
  console.log('Running tests...\n')
  
  await testSmsStatus()
  await testBasicSms(testNumber)
  await testOtpSms(testNumber)
  await testAppointmentSms(testNumber)
  await testTokenReadySms(testNumber)
  
  printResults()
  
  // Exit with error code if any test failed
  const hasFailures = results.some(r => !r.success)
  process.exit(hasFailures ? 1 : 0)
}

// Run tests
runTests().catch((error) => {
  console.error('\n❌ Test execution failed:', error.message)
  process.exit(1)
})
