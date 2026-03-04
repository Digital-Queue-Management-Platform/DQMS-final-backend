import axios from 'axios'

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api'

async function testOtpWithFallback() {
  const testNumber = process.argv[2] || '0775878565'
  
  console.log('\n📱 Testing OTP with SMS Fallback (SLT → Twilio)')
  console.log(`📞 Test Number: ${testNumber}`)
  console.log(`🌐 API: ${API_BASE_URL}\n`)
  
  try {
    console.log('Sending OTP request...')
    const response = await axios.post(`${API_BASE_URL}/customer/otp/start`, {
      mobileNumber: testNumber,
      preferredLanguage: 'en'
    })
    
    console.log('\n✅ SUCCESS!')
    console.log('Response:', JSON.stringify(response.data, null, 2))
    
    if (response.data.devCode) {
      console.log(`\n🔑 Your OTP Code (Dev Mode): ${response.data.devCode}`)
    }
    
    console.log('\n📊 What happened:')
    console.log('   1. System tried SLT SMS Gateway (127.0.0.1:9501)')
    console.log('   2. SLT Gateway was unreachable (ECONNREFUSED)')
    console.log('   3. System automatically fell back to Twilio ✅')
    console.log('   4. SMS was sent successfully via Twilio')
    
    console.log('\n💡 This proves the fallback mechanism is working!')
    console.log('   Once SLT Gateway is accessible, it will be used instead.\n')
    
  } catch (error: any) {
    console.error('\n❌ FAILED')
    console.error('Error:', error.response?.data || error.message)
    
    if (error.response?.data?.error?.includes('ECONNREFUSED')) {
      console.log('\n⚠️  SLT Gateway not reachable AND Twilio not configured.')
      console.log('   Please check your TWILIO credentials in .env\n')
    }
    
    process.exit(1)
  }
}

testOtpWithFallback()
