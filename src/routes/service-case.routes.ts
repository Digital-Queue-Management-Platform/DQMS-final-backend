import { Router } from "express"
import { prisma } from "../server"

const router = Router()

// Public: Get case by reference number, mobile, or email (for customers)
router.get("/*", async (req, res) => {
  try {
    const lookup = decodeURIComponent((req.params as any)[0])
    const serviceCases: any[] = await (prisma as any).serviceCase.findMany({
      where: {
        OR: [
          { refNumber: lookup },
          { customer: { mobileNumber: lookup } },
          { customer: { email: lookup } },
          { customer: { name: { contains: lookup, mode: 'insensitive' } } },
        ]
      },
      include: {
        outlet: true,
        officer: true,
        customer: true,
        token: {
          include: {
            feedback: true,
            transferLogs: {
              include: {
                fromOfficer: { select: { id: true, name: true, counterNumber: true } }
              },
              orderBy: { createdAt: 'asc' }
            }
          }
        },
        updates: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' }, // newest first
    })

    if (!serviceCases || serviceCases.length === 0) {
      return res.status(404).json({ error: "No records found for this reference, mobile number, or email." })
    }

    // Resolve service titles from codes
    const allServiceCodes = new Set<string>()
    for (const sc of serviceCases) {
      if (sc.serviceTypes) {
        for (const code of sc.serviceTypes) allServiceCodes.add(code)
      }
    }
    
    const serviceRecords = allServiceCodes.size > 0
      ? await prisma.service.findMany({
          where: { code: { in: Array.from(allServiceCodes) } },
          select: { code: true, title: true }
        })
      : []
    const serviceTitleMap: Record<string, string> = {}
    for (const s of serviceRecords) serviceTitleMap[s.code] = s.title

    const results = serviceCases.map(sc => {
      const tok = sc.token ?? null
      const feedback = tok?.feedback ?? null
      const waitDurationMs = tok?.calledAt && tok?.createdAt
        ? new Date(tok.calledAt).getTime() - new Date(tok.createdAt).getTime()
        : null
      const serviceDurationMs = tok?.completedAt && tok?.startedAt
        ? new Date(tok.completedAt).getTime() - new Date(tok.startedAt).getTime()
        : null
      const totalDurationMs = tok?.completedAt && tok?.createdAt
        ? new Date(tok.completedAt).getTime() - new Date(tok.createdAt).getTime()
        : null

      return {
        refNumber: sc.refNumber,
        status: sc.status,
        outlet: { id: sc.outlet.id, name: sc.outlet.name, location: sc.outlet.location },
        serviceTypes: sc.serviceTypes,
        services: (sc.serviceTypes || []).map((code: string) => ({
          code,
          title: serviceTitleMap[code] || code
        })),
        createdAt: sc.createdAt,
        completedAt: sc.completedAt,
        lastUpdatedAt: sc.lastUpdatedAt,
        customer: sc.customer ? {
          name: sc.customer.name,
          mobileNumber: sc.customer.mobileNumber,
          email: sc.customer.email || null,
        } : null,
        officer: sc.officer ? {
          name: sc.officer.name,
          mobileNumber: sc.officer.mobileNumber,
          counterNumber: sc.officer.counterNumber ?? null,
        } : null,
        token: tok ? {
          tokenNumber: tok.tokenNumber,
          isPriority: tok.isPriority,
          isTransferred: tok.isTransferred,
          preferredLanguages: tok.preferredLanguages,
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
        transferLogs: (tok?.transferLogs || []).map((tl: any) => ({
          id: tl.id,
          fromOfficer: tl.fromOfficer,
          fromCounterNumber: tl.fromCounterNumber,
          toCounterNumber: tl.toCounterNumber,
          previousServiceTypes: tl.previousServiceTypes,
          newServiceTypes: tl.newServiceTypes,
          notes: tl.notes,
          createdAt: tl.createdAt,
        })),
        feedback: feedback ? {
          rating: feedback.rating,
          comment: feedback.comment ?? null,
          createdAt: feedback.createdAt,
          isResolved: (feedback as any).isResolved || false,
          resolutionComment: (feedback as any).resolutionComment ?? null,
        } : null,
        updates: (sc.updates as any[]).map((u: any) => ({
          id: u.id,
          actorRole: u.actorRole,
          actorId: u.actorId,
          status: u.status,
          note: u.note,
          createdAt: u.createdAt,
        }))
      }
    })

    res.json(results)
  } catch (e) {
    console.error('ServiceCase get error:', e)
    res.status(500).json({ error: 'Failed to fetch reference' })
  }
})

export default router
