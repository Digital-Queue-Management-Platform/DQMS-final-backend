import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"
import smsHelper from "../utils/smsHelper"

const router = Router()

// Reuse OTP JWT for booking verification (resolved at request time for safety)
const getOtpJwtSecret = () => process.env.OTP_JWT_SECRET || "otp-dev-secret"

function toE164(mobile: string): string {
  const cleaned = (mobile || "").replace(/\D/g, "")
  if (!cleaned) return mobile
  if (cleaned.startsWith("0") && cleaned.length === 10) return "+94" + cleaned.substring(1)
  if (cleaned.startsWith("94") && cleaned.length === 11) return "+" + cleaned
  if (mobile.startsWith("+")) return mobile
  return "+" + cleaned
}

function digitsOnly(m: string | undefined | null) {
  return (m || "").replace(/\D/g, "")
}

// Book an appointment
router.post("/book", async (req, res) => {
  try {
    const { name, mobileNumber, outletId, serviceTypes, appointmentAt, preferredLanguage, verifiedMobileToken, notes, email, nicNumber, sltTelephoneNumber, billPaymentIntent, billPaymentAmount, billPaymentMethod } = req.body || {}

    if (!name || !mobileNumber || !outletId || !Array.isArray(serviceTypes) || serviceTypes.length === 0 || !appointmentAt) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Enforce phone verification via OTP (same policy as registration)
    try {
      const payload = (jwt as any).verify(verifiedMobileToken || "", getOtpJwtSecret() as jwt.Secret) as any
      const sameNumber = digitsOnly(payload?.mobileNumber) === digitsOnly(mobileNumber)
      if (payload?.purpose !== "phone_verification" || !sameNumber) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[APPT][VERIFY][MISMATCH]', {
            purpose: payload?.purpose,
            payloadMobile: payload?.mobileNumber,
            requestMobile: mobileNumber,
            digitsPayload: digitsOnly(payload?.mobileNumber),
            digitsRequest: digitsOnly(mobileNumber),
          })
        }
        return res.status(403).json({ error: "Phone verification required" })
      }
    } catch (e: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[APPT][VERIFY][ERROR]', e?.message)
      }
      return res.status(403).json({ error: "Phone verification required" })
    }

    // Validate outlet
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
    if (!outlet || !outlet.isActive) {
      return res.status(404).json({ error: "Outlet not found or inactive" })
    }

    // Validate 24-hour advance booking requirement
    const appointmentDate = new Date(appointmentAt)
    const now = new Date()
    const hoursUntilAppointment = (appointmentDate.getTime() - now.getTime()) / (1000 * 60 * 60)
    if (hoursUntilAppointment < 24) {
      return res.status(400).json({ error: "Appointments must be booked at least 24 hours in advance" })
    }

    // Create appointment using Prisma (handles array types properly)
    const appt = await prisma.appointment.create({
      data: {
        name,
        mobileNumber,
        outletId,
        serviceTypes,
        preferredLanguage: preferredLanguage || undefined,
        sltTelephoneNumber: sltTelephoneNumber || undefined,
        billPaymentIntent: billPaymentIntent || undefined,
        billPaymentAmount: billPaymentIntent === 'partial' ? billPaymentAmount : undefined,
        billPaymentMethod: billPaymentMethod || undefined,
        appointmentAt: new Date(appointmentAt),
        status: 'booked',
        notes: notes || undefined,
      },
    })

    // Optionally upsert customer basics for smoother check-in later
    try {
      const existing = await prisma.customer.findFirst({ where: { mobileNumber } })
      if (!existing) {
        await prisma.customer.create({ data: { name, mobileNumber, nicNumber: nicNumber || undefined, email: email || undefined } })
      }
    } catch (e) {
      // best-effort, ignore failures
    }

    // Best-effort SMS confirmation via unified SMS helper (localized by preferredLanguage)
    try {
      const when = new Date(appointmentAt)
      const whenStr = when.toLocaleString('en-GB', {
        timeZone: 'Asia/Colombo',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })

      // Map service codes to titles for SMS
      const serviceRecords = await prisma.service.findMany({
        where: { code: { in: serviceTypes } },
        select: { title: true }
      })
      const services = serviceRecords.map(s => s.title).join(', ') || ''

      const lang: 'en' | 'si' | 'ta' = (preferredLanguage === 'si' || preferredLanguage === 'ta') ? preferredLanguage : 'en'

      const result = await smsHelper.sendAppointmentConfirmation(mobileNumber, {
        name,
        outletName: outlet.name,
        dateTime: whenStr,
        services
      }, lang)

      if (result.success) {
        console.log(`[APPT][SMS] Sent confirmation via ${result.provider}`)
      } else {
        console.warn('[APPT][SMS] Failed:', result.error)
      }
    } catch (e) {
      console.error('Appointment SMS send failed:', e)
    }

    res.json({ success: true, appointment: appt })
  } catch (error) {
    console.error("Appointment booking error:", error)
    res.status(500).json({ error: "Failed to book appointment" })
  }
})

// List my appointments by mobile
router.get("/my", async (req, res) => {
  try {
    const mobileNumber = req.query.mobileNumber as string
    if (!mobileNumber) return res.status(400).json({ error: "mobileNumber is required" })

    const now = new Date()
    const appts: any = await prisma.$queryRaw`
      SELECT * FROM "Appointment" WHERE "mobileNumber" = ${mobileNumber} ORDER BY "appointmentAt" ASC
    `
    res.json({ appointments: appts as any[], now: now.toISOString() })
  } catch (error) {
    console.error("Appointments fetch error:", error)
    res.status(500).json({ error: "Failed to fetch appointments" })
  }
})

// Staff view: list appointments for an outlet and optional date
router.get("/outlet/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params
    const date = req.query.date as string | undefined
    let dateStart: Date | undefined
    let dateEnd: Date | undefined
    if (date) {
      dateStart = new Date(date)
      dateStart.setHours(0, 0, 0, 0)
      dateEnd = new Date(dateStart)
      dateEnd.setHours(23, 59, 59, 999)
    }

    const appts: any = dateStart && dateEnd
      ? await prisma.$queryRaw`SELECT * FROM "Appointment" WHERE "outletId" = ${outletId} AND "appointmentAt" BETWEEN ${dateStart} AND ${dateEnd} ORDER BY "appointmentAt" ASC`
      : await prisma.$queryRaw`SELECT * FROM "Appointment" WHERE "outletId" = ${outletId} ORDER BY "appointmentAt" ASC`
    res.json(appts as any[])
  } catch (error) {
    console.error("Outlet appointments fetch error:", error)
    res.status(500).json({ error: "Failed to fetch outlet appointments" })
  }
})

// Get available services for appointments
router.get("/services", async (req, res) => {
  try {
    // Use raw query to avoid Prisma client issues before regeneration
    const services = await prisma.$queryRaw`
      SELECT "id", "code", "title", "description", "isActive", "order", "isPriorityService"
      FROM "Service" 
      WHERE "isActive" = true 
      ORDER BY "order" ASC, "createdAt" ASC
    `
    res.json(services)
  } catch (error) {
    console.error("Fetch services error:", error)
    res.status(500).json({ error: "Failed to fetch services" })
  }
})

export default router
