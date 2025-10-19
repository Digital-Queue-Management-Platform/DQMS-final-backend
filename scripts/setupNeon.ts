#!/usr/bin/env node

/**
 * Neon Database Setup Script
 * Run this after setting up your Neon database and updating DATABASE_URL
 */

import { PrismaClient } from '@prisma/client'

async function setupNeonDatabase() {
  console.log('🔄 Setting up Neon PostgreSQL database...')
  
  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not set')
    console.log('Please update your .env file with your Neon connection string')
    process.exit(1)
  }

  if (process.env.DATABASE_URL.includes('your-neon-endpoint')) {
    console.error('❌ Please update DATABASE_URL with your actual Neon connection string')
    console.log('Check the setup-neon.md file for instructions')
    process.exit(1)
  }

  console.log('✅ DATABASE_URL is configured')

  try {
    // Test database connection
    console.log('🔄 Testing database connection...')
    const prisma = new PrismaClient()
    
    // Try to connect
    await prisma.$connect()
    console.log('✅ Successfully connected to Neon database')

    // Check if tables exist
    console.log('🔄 Checking database schema...')
    try {
      const customerCount = await prisma.customer.count()
      console.log(`✅ Database schema is ready. Found ${customerCount} customers.`)
    } catch (error: any) {
      if (error.code === 'P2021') {
        console.log('⚠️  Database schema not found. Running migrations...')
        console.log('Please run: npx prisma migrate deploy')
      } else {
        console.error('❌ Schema check failed:', error.message)
      }
    }

    await prisma.$disconnect()
    
    console.log('\n🎉 Neon database setup complete!')
    console.log('\nNext steps:')
    console.log('1. Run: npx prisma migrate deploy')
    console.log('2. Run: npm run dev')
    console.log('3. Test your application')
    
  } catch (error: any) {
    console.error('❌ Database connection failed:', error.message)
    console.log('\nTroubleshooting:')
    console.log('1. Check your DATABASE_URL format')
    console.log('2. Ensure your Neon database is active')
    console.log('3. Verify network connectivity')
    process.exit(1)
  }
}

// Run the setup
setupNeonDatabase().catch(console.error)