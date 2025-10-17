import emailService from '../src/services/emailService'
import { generateSecurePassword, testPasswordGeneration } from '../src/utils/passwordGenerator'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

async function testEmailSetup() {
  console.log('🧪 DQMS Email System Test')
  console.log('=' .repeat(50))
  
  // Test 1: Check environment variables
  console.log('\n1️⃣ Environment Variables Check:')
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']
  let envOk = true
  
  for (const varName of requiredVars) {
    const value = process.env[varName]
    if (value) {
      console.log(`✅ ${varName}: ${varName === 'SMTP_PASS' ? '***hidden***' : value}`)
    } else {
      console.log(`❌ ${varName}: Not set`)
      envOk = false
    }
  }
  
  if (!envOk) {
    console.log('\n❌ Email configuration incomplete. Please update your .env file.')
    return
  }
  
  // Test 2: Password generation
  console.log('\n2️⃣ Password Generation Test:')
  testPasswordGeneration(5)
  
  // Test 3: SMTP connection
  console.log('\n3️⃣ SMTP Connection Test:')
  try {
    const connectionTest = await emailService.testConnection()
    if (connectionTest) {
      console.log('✅ SMTP connection successful')
    } else {
      console.log('❌ SMTP connection failed')
      return
    }
  } catch (error) {
    console.log('❌ SMTP connection error:', error)
    return
  }
  
  // Test 4: Send test email
  console.log('\n4️⃣ Test Email Send:')
  const testEmail = process.env.SMTP_USER || 'test@example.com'
  
  try {
    const testPassword = generateSecurePassword()
    const emailResult = await emailService.sendManagerWelcomeEmail({
      managerName: 'Test Manager',
      managerEmail: testEmail,
      regionName: 'Test Region',
      temporaryPassword: testPassword,
      loginUrl: 'http://localhost:3000/manager-login'
    })
    
    if (emailResult) {
      console.log(`✅ Test email sent successfully to: ${testEmail}`)
      console.log(`🔑 Test password generated: ${testPassword}`)
      console.log('📧 Please check your inbox (and spam folder)')
    } else {
      console.log('❌ Failed to send test email')
    }
  } catch (error) {
    console.log('❌ Email sending error:', error)
  }
  
  console.log('\n🎉 Email system test completed!')
  console.log('=' .repeat(50))
}

// Run the test
testEmailSetup().catch(console.error)