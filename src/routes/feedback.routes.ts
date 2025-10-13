import { Router } from "express"
import { prisma, broadcast } from "../server"

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

    const feedback = await prisma.feedback.create({
      data: {
        tokenId,
        customerId: token.customerId,
        rating,
        comment: comment || undefined,
      },
    })

    // Create alert for negative feedback (rating 1 or 2)
    if (rating <= 2) {
      await prisma.alert.create({
        data: {
          type: "negative_feedback",
          severity: "high",
          message: `Negative feedback (${rating}/5) received for token ${token.tokenNumber} at ${token.outlet.name}`,
          relatedEntity: tokenId,
        },
      })

      // Broadcast alert
      broadcast({ type: "NEGATIVE_FEEDBACK", data: { feedback, token } })
    }

    res.json({ success: true, feedback })
  } catch (error) {
    console.error("Feedback error:", error)
    res.status(500).json({ error: "Failed to submit feedback" })
  }
})

export default router
