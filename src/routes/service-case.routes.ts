import { Router } from "express"
import { prisma } from "../server"

const router = Router()

// Public: Get case by reference number (for customers)
router.get("/*", async (req, res) => {
  try {
    const refNumber = decodeURIComponent((req.params as any)[0])
    const sc: any = await (prisma as any).serviceCase.findUnique({
      where: { refNumber },
      include: {
        outlet: true,
        officer: true,
        customer: true,
        token: {
          select: {
            tokenNumber: true,
            preferredLanguages: true,
            isPriority: true,
            isTransferred: true,
            accountRef: true,
            sltTelephoneNumber: true,
            billPaymentIntent: true,
            billPaymentAmount: true,
            billPaymentMethod: true,
            createdAt: true,
            calledAt: true,
            startedAt: true,
            completedAt: true,
          }
        },
        updates: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!sc) return res.status(404).json({ error: "Reference not found" })

    const tok = sc.token ?? null
    const waitDurationMs = tok?.calledAt && tok?.createdAt
      ? new Date(tok.calledAt).getTime() - new Date(tok.createdAt).getTime()
      : null
    const serviceDurationMs = tok?.completedAt && tok?.startedAt
      ? new Date(tok.completedAt).getTime() - new Date(tok.startedAt).getTime()
      : null
    const totalDurationMs = tok?.completedAt && tok?.createdAt
      ? new Date(tok.completedAt).getTime() - new Date(tok.createdAt).getTime()
      : null

    res.json({
      refNumber: sc.refNumber,
      status: sc.status,
      outlet: { id: sc.outletId, name: sc.outlet.name, location: sc.outlet.location },
      serviceTypes: sc.serviceTypes,
      createdAt: sc.createdAt,
      completedAt: sc.completedAt,
      preferredLanguage: Array.isArray(tok?.preferredLanguages) && tok.preferredLanguages.length > 0
        ? tok.preferredLanguages[0]
        : null,
      token: tok ? {
        tokenNumber: tok.tokenNumber,
        isPriority: tok.isPriority,
        isTransferred: tok.isTransferred,
        accountRef: tok.accountRef ?? null,
        sltTelephoneNumber: tok.sltTelephoneNumber ?? null,
        billPaymentIntent: tok.billPaymentIntent ?? null,
        billPaymentAmount: tok.billPaymentAmount ?? null,
        billPaymentMethod: tok.billPaymentMethod ?? null,
        createdAt: tok.createdAt,
        calledAt: tok.calledAt ?? null,
        startedAt: tok.startedAt ?? null,
        completedAt: tok.completedAt ?? null,
      } : null,
      timeSpans: { waitDurationMs, serviceDurationMs, totalDurationMs },
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
