import { Router } from "express"
import { prisma, broadcast } from "../server"
import { FeedbackService } from "../services/feedbackService"

const router = Router()

// Submit feedback
router.post("/submit", async (req, res) => {
  try {
  const { tokenId, rating, comment } = req.body

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      include: { officer: true, outlet: { include: { region: true } } },
    })

    if (!token) {
      return res.status(404).json({ error: "Token not found" })
    }

    // Validate rating
    const numericRating = Number(rating)
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: "Rating must be an integer between 1 and 5" })
    }

    // Prevent duplicate feedback for same token (overall feedback once per token)
    const existing = await prisma.feedback.findFirst({ where: { tokenId } })
    if (existing) {
      return res.status(409).json({ error: "Feedback already submitted for this token" })
    }

    const feedback = await prisma.feedback.create({
      data: {
        tokenId,
        customerId: token.customerId,
        rating: numericRating,
        comment: comment || undefined,
      },
    })

    // Automatically assign feedback based on rating using FeedbackService
    try {
      await FeedbackService.assignFeedback(feedback.id)
    } catch (assignError) {
      console.error("Failed to assign feedback:", assignError)
      // Don't fail the entire request if assignment fails
    }

    // Create rating-based alerts with proper routing
    if (numericRating <= 3) {
      let alertType = ""
      let alertSeverity = "medium"
      let broadcastType = ""
      let alertMessage = ""

      if (numericRating === 1) {
        // 1 star - Critical alert for Admin Dashboard
        alertType = "critical_feedback"
        alertSeverity = "critical"
        broadcastType = "CRITICAL_FEEDBACK_ALERT"
        alertMessage = `CRITICAL: 1-star feedback received for token ${token.tokenNumber} at ${token.outlet.name}. Immediate admin attention required.`
      } else if (numericRating === 2) {
        // 2 star - High priority alert for RTOM/Manager Dashboard  
        alertType = "high_priority_feedback"
        alertSeverity = "high"
        broadcastType = "RTOM_FEEDBACK_ALERT"
        alertMessage = `HIGH PRIORITY: 2-star feedback received for token ${token.tokenNumber} at ${token.outlet.name}. Regional manager intervention needed.`
      } else if (numericRating === 3) {
        // 3 star - Medium priority alert for Teleshop Manager Dashboard
        alertType = "moderate_feedback"
        alertSeverity = "medium"
        broadcastType = "TELESHOP_MANAGER_FEEDBACK_ALERT"
        alertMessage = `MODERATE: 3-star feedback received for token ${token.tokenNumber} at ${token.outlet.name}. Local manager attention recommended.`
      }

      // Create the alert in database
      const alert = await prisma.alert.create({
        data: {
          type: alertType,
          severity: alertSeverity,
          message: alertMessage,
          relatedEntity: tokenId,
        },
      })

      // Broadcast to appropriate dashboards
      broadcast({ 
        type: broadcastType, 
        data: { 
          feedback, 
          token, 
          alert,
          rating: numericRating,
          alertLevel: numericRating === 1 ? "admin" : numericRating === 2 ? "rtom" : "teleshop_manager"
        } 
      })

      // Also broadcast the generic negative feedback for backward compatibility (for ratings 1-2)
      if (numericRating <= 2) {
        broadcast({ type: "NEGATIVE_FEEDBACK", data: { feedback, token } })
      }
    }

    // Create completed service records for all services in the token
    if (token.serviceTypes && token.serviceTypes.length > 0) {
      try {
        for (const serviceCode of token.serviceTypes) {
          // Find the service by code
          const service = await prisma.service.findUnique({
            where: { code: serviceCode }
          })
          
          if (service && token.assignedTo) {
            await FeedbackService.createCompletedService(
              tokenId,
              service.id,
              undefined, // duration - could be calculated from startedAt/completedAt
              `Service completed for token ${token.tokenNumber}`
            )
          }
        }
      } catch (serviceError) {
        console.error("Failed to create completed service records:", serviceError)
        // Don't fail the entire request if service tracking fails
      }
    }

    res.json({ success: true, feedback })
  } catch (error) {
    console.error("Feedback error:", error)
    res.status(500).json({ error: "Failed to submit feedback" })
  }
})

export default router
