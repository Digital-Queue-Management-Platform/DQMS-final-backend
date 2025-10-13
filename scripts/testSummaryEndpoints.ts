import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const prisma = new PrismaClient()

async function testSummaryEndpoints() {
  try {
    // First, find an officer
    const officer = await prisma.officer.findFirst()
    if (!officer) {
      console.log('No officers found in database')
      return
    }

    console.log(`Testing with officer: ${officer.name} (${officer.id})`)
    
    const baseURL = 'http://localhost:3001/api/officer'
    
    // Test served summary
    console.log('\n--- Testing /summary/served endpoint ---')
    try {
      const servedRes = await axios.get(`${baseURL}/summary/served/${officer.id}`)
      console.log('Served Summary Response:', JSON.stringify(servedRes.data, null, 2))
    } catch (error: any) {
      console.error('Served endpoint error:', error.response?.data || error.message)
    }

    // Test breaks summary
    console.log('\n--- Testing /summary/breaks endpoint ---')
    try {
      const breaksRes = await axios.get(`${baseURL}/summary/breaks/${officer.id}`)
      console.log('Breaks Summary Response:', JSON.stringify(breaksRes.data, null, 2))
    } catch (error: any) {
      console.error('Breaks endpoint error:', error.response?.data || error.message)
    }

    // Test feedback summary
    console.log('\n--- Testing /summary/feedback endpoint ---')
    try {
      const feedbackRes = await axios.get(`${baseURL}/summary/feedback/${officer.id}`)
      console.log('Feedback Summary Response:', JSON.stringify(feedbackRes.data, null, 2))
    } catch (error: any) {
      console.error('Feedback endpoint error:', error.response?.data || error.message)
    }

  } catch (error) {
    console.error('Test error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testSummaryEndpoints()