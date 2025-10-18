import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function createTestAlerts() {
  try {
    console.log('Creating test alerts...')

    // Create a variety of test alerts
    const alerts = await Promise.all([
      // High severity alert for long wait time
      prisma.alert.create({
        data: {
          type: "long_wait",
          severity: "high",
          message: "Token #A025 has been waiting more than 15 minutes at Colombo Central Branch",
          relatedEntity: null,
        },
      }),

      // Medium severity alert for system issue
      prisma.alert.create({
        data: {
          type: "system_alert",
          severity: "medium",
          message: "Network connectivity issues detected at Galle Branch",
          relatedEntity: null,
        },
      }),

      // High severity alert for negative feedback
      prisma.alert.create({
        data: {
          type: "negative_feedback",
          severity: "high",
          message: "Negative feedback (1/5) received for token B012 at Kandy Branch - Poor service quality",
          relatedEntity: null,
        },
      }),

      // Low severity info alert
      prisma.alert.create({
        data: {
          type: "info",
          severity: "low",
          message: "Daily analytics report has been generated successfully",
          relatedEntity: null,
        },
      }),

      // Medium severity capacity alert
      prisma.alert.create({
        data: {
          type: "capacity_alert",
          severity: "medium",
          message: "Jaffna Branch is operating at 95% capacity - consider opening additional counter",
          relatedEntity: null,
        },
      }),

      // High severity alert for another negative feedback
      prisma.alert.create({
        data: {
          type: "negative_feedback",
          severity: "high",
          message: "Negative feedback (2/5) received for token C008 at Matara Branch - Long waiting time complaint",
          relatedEntity: null,
        },
      }),

      // Low severity maintenance alert
      prisma.alert.create({
        data: {
          type: "maintenance",
          severity: "low",
          message: "Scheduled system maintenance completed successfully at 02:00 AM",
          relatedEntity: null,
        },
      }),
    ])

    console.log(`Successfully created ${alerts.length} test alerts:`)
    alerts.forEach((alert, index) => {
      console.log(`${index + 1}. [${alert.severity.toUpperCase()}] ${alert.message}`)
    })

    console.log('\n✅ Test alerts created! You should now see notifications in the admin dashboard.')

  } catch (error) {
    console.error('Failed to create test alerts:', error)
  } finally {
    await prisma.$disconnect()
  }
}

createTestAlerts()