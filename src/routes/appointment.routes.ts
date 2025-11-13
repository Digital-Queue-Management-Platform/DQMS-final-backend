import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"
import Twilio from "twilio"

const router = Router()

// Reuse OTP JWT for booking verification (resolved at request time for safety)
const getOtpJwtSecret = () => process.env.OTP_JWT_SECRET || "otp-dev-secret"

// Twilio configuration (read at request time to avoid early-evaluation issues)
const twilioConfig = () => {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ""
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ""
  const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || ""
  const TWILIO_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || ""
  const client = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) ? Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null
  return { client, TWILIO_FROM_NUMBER, TWILIO_MESSAGING_SERVICE_SID }
}

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
    const { name, mobileNumber, outletId, serviceTypes, appointmentAt, preferredLanguage, verifiedMobileToken, notes, email, nicNumber } = req.body || {}

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

    // Insert via raw SQL to avoid prisma client regeneration dependency
    await prisma.$executeRaw`
      INSERT INTO "Appointment" ("id","name","mobileNumber","outletId","serviceTypes","preferredLanguage","appointmentAt","status","notes","createdAt")
      VALUES (gen_random_uuid()::text, ${name}, ${mobileNumber}, ${outletId}, ${serviceTypes}, ${preferredLanguage || null}, ${new Date(appointmentAt)}, 'booked', ${notes || null}, now())
    `
    const created = await prisma.$queryRaw`SELECT * FROM "Appointment" WHERE "mobileNumber" = ${mobileNumber} AND "outletId" = ${outletId} ORDER BY "createdAt" DESC LIMIT 1` as any[]
    const appt = created[0]

    // Optionally upsert customer basics for smoother check-in later
    try {
      const existing = await prisma.customer.findFirst({ where: { mobileNumber } })
      if (!existing) {
        await prisma.customer.create({ data: { name, mobileNumber, nicNumber: nicNumber || undefined, email: email || undefined } })
      }
    } catch (e) {
      // best-effort, ignore failures
    }

    // Best-effort SMS confirmation via Twilio (localized by preferredLanguage)
    try {
      const { client: twilioClient, TWILIO_FROM_NUMBER, TWILIO_MESSAGING_SERVICE_SID } = twilioConfig()
      if (twilioClient && (TWILIO_MESSAGING_SERVICE_SID || TWILIO_FROM_NUMBER)) {
        const to = toE164(mobileNumber)
        const when = new Date(appointmentAt)
        const whenStr = when.toLocaleString()
        const services = Array.isArray(serviceTypes) ? serviceTypes.join(', ') : ''
        // Build absolute link to 'My Appointments' page
        const origins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
        let baseUrl = origins[0] || ''
        
        // Always prioritize Vercel URLs if available
        const vercelUrl = origins.find(o => o.includes('vercel.app') || (o.includes('https://') && !o.includes('localhost')))
        if (vercelUrl) {
          baseUrl = vercelUrl
        } else if (process.env.NODE_ENV === 'production') {
          // In production, prefer any HTTPS URL over localhost
          baseUrl = origins.find(o => o.startsWith('https://') && !o.includes('localhost')) || baseUrl
        }
        
        const manageUrl = baseUrl ? `${baseUrl}/appointment/my` : '/appointment/my'
        const lang: 'en'|'si'|'ta' = (preferredLanguage === 'si' || preferredLanguage === 'ta') ? preferredLanguage : 'en'
        const bodies: Record<'en'|'si'|'ta', string> = {
          /*en: `Appointment confirmed for ${whenStr} at ${outlet.name}. Services: ${services}. Manage: ${manageUrl}`,
          si: `${outlet.name} ශාඛාවේදී ${whenStr} ට ඔබගේ වෙන්කරවාගැනීම තහවුරු විය. සේවාවන්: ${services}. කළමනාකරණය: ${manageUrl}`,
          ta: `${outlet.name} கிளையில் ${whenStr} உங்கள் நேரம் உறுதிப்படுத்தப்பட்டுள்ளது. சேவைகள்: ${services}. மேலாண்மை: ${manageUrl}`,*/
          en: `Appointment confirmed for ${whenStr} at ${outlet.name}. Services: ${services}`,
          si: `${outlet.name} ශාඛාවේදී ${whenStr} ට ඔබගේ වෙන්කරවාගැනීම තහවුරු විය. සේවාවන්: ${services}`,
          ta: `${outlet.name} கிளையில் ${whenStr} உங்கள் நேரம் உறுதிப்படுத்தப்பட்டுள்ளது. சேவைகள்: ${services}`,
        }
        const body = bodies[lang]

        const params: any = { to, body }
        if (TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID
        else if (TWILIO_FROM_NUMBER) params.from = TWILIO_FROM_NUMBER
        await twilioClient.messages.create(params)
      } else {
        console.log('[APPT][SMS] Twilio not configured; skipping SMS')
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
      dateStart.setHours(0,0,0,0)
      dateEnd = new Date(dateStart)
      dateEnd.setHours(23,59,59,999)
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

export default router
