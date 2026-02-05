import { prisma } from "../server"

export class FeedbackService {
  /**
   * Assigns feedback to the appropriate role based on rating
   * 1 star -> Admin
   * 2 star -> RTOM  
   * 3 star -> Teleshop Manager
   * 4-5 star -> No assignment needed (positive feedback)
   */
  static async assignFeedback(feedbackId: string) {
    try {
      const feedback = await prisma.feedback.findUnique({
        where: { id: feedbackId },
        include: {
          token: {
            include: {
              officer: {
                include: {
                  outlet: {
                    include: {
                      region: true
                    }
                  }
                }
              }
            }
          }
        }
      })

      if (!feedback) {
        throw new Error("Feedback not found")
      }

      let assignedTo = null
      let assignedToId = null

      switch (feedback.rating) {
        case 1:
          // 1 star -> Admin (we'll use a special admin identifier)
          assignedTo = "admin"
          assignedToId = "system_admin"
          break

        case 2:
          // 2 star -> RTOM
          assignedTo = "regional_manager"
          if (feedback.token?.officer?.outlet?.regionId) {
            assignedToId = feedback.token.officer.outlet.regionId
          }
          break

        case 3:
          // 3 star -> Teleshop Manager
          assignedTo = "teleshop_manager"
          if (feedback.token?.officer?.outletId) {
            // Find teleshop manager for this outlet's branch
            const teleshopManager = await prisma.teleshopManager.findFirst({
              where: { branchId: feedback.token.officer.outletId }
            })
            if (teleshopManager) {
              assignedToId = teleshopManager.id
            }
          }
          break

        case 4:
        case 5:
          // 4-5 star -> No assignment needed (positive feedback)
          assignedTo = null
          assignedToId = null
          break

        default:
          throw new Error(`Invalid rating: ${feedback.rating}`)
      }

      // Update feedback with assignment
      const updatedFeedback = await prisma.feedback.update({
        where: { id: feedbackId },
        data: {
          assignedTo,
          assignedToId
        } as any
      })

      return updatedFeedback
    } catch (error) {
      console.error("Error assigning feedback:", error)
      throw error
    }
  }

  /**
   * Create completed service record when a token is completed
   */
  static async createCompletedService(
    tokenId: string,
    serviceId: string,
    duration?: number,
    notes?: string
  ) {
    try {
      const token = await prisma.token.findUnique({
        where: { id: tokenId },
        include: {
          officer: true,
          customer: true,
          outlet: true
        }
      })

      if (!token) {
        throw new Error("Token not found")
      }

      if (!token.officer) {
        throw new Error("Token has no assigned officer")
      }

      // Find teleshop manager for this outlet's branch
      const teleshopManager = await prisma.teleshopManager.findFirst({
        where: { branchId: token.officer.outletId }
      })

      const completedService = await (prisma as any).completedService.create({
        data: {
          tokenId,
          serviceId,
          officerId: token.officer.id,
          teleshopManagerId: teleshopManager?.id || null,
          customerId: token.customerId,
          outletId: token.outletId,
          duration,
          notes
        }
      })

      return completedService
    } catch (error) {
      console.error("Error creating completed service:", error)
      throw error
    }
  }

  /**
   * Get feedback statistics for different roles
   */
  static async getFeedbackStats(role: string, roleId: string) {
    try {
      let where: any = {}

      switch (role) {
        case "admin":
          where = { assignedTo: "admin", assignedToId: "system_admin" }
          break
        case "regional_manager":
          where = { assignedTo: "regional_manager", assignedToId: roleId }
          break
        case "teleshop_manager":
          where = { assignedTo: "teleshop_manager", assignedToId: roleId }
          break
        default:
          throw new Error(`Invalid role: ${role}`)
      }

      const [total, unresolved, resolved, todayCount] = await Promise.all([
        prisma.feedback.count({ where }),
        prisma.feedback.count({ where: { ...where, isResolved: false } } as any),
        prisma.feedback.count({ where: { ...where, isResolved: true } } as any),
        prisma.feedback.count({
          where: {
            ...where,
            createdAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0))
            }
          }
        })
      ])

      return {
        total,
        unresolved,
        resolved,
        todayCount
      }
    } catch (error) {
      console.error("Error getting feedback stats:", error)
      throw error
    }
  }
}