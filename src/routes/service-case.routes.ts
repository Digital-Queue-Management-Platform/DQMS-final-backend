import { Router } from "express"
import { prisma } from "../server"

const router = Router()

// Public: Get case by reference number (for customers)
router.get("/:refNumber", async (req, res) => {
  try {
    const { refNumber } = req.params
    const sc: any = await (prisma as any).serviceCase.findUnique({
      where: { refNumber },
      include: {
        outlet: true,
        officer: true,
        customer: true,
        token: { select: { preferredLanguages: true } },
        updates: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!sc) return res.status(404).json({ error: "Reference not found" })

    res.json({
      refNumber: sc.refNumber,
      status: sc.status,
      outlet: { id: sc.outletId, name: sc.outlet.name, location: sc.outlet.location },
      serviceTypes: sc.serviceTypes,
      createdAt: sc.createdAt,
      completedAt: sc.completedAt,
      // Derive a single preferred language string from token.preferredLanguages if present
      preferredLanguage: Array.isArray(sc?.token?.preferredLanguages) && sc.token.preferredLanguages.length > 0
        ? sc.token.preferredLanguages[0]
        : null,
      updates: (sc.updates as any[]).map((u: any) => ({
        id: u.id,
        actorRole: u.actorRole,
        actorId: u.actorId,
        status: u.status,
        note: u.note,
        createdAt: u.createdAt,
      }))
    })
  } catch (e) {
    console.error('ServiceCase get error:', e)
    res.status(500).json({ error: 'Failed to fetch reference' })
  }
})

export default router
