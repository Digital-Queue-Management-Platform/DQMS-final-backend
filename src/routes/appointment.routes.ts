import { Router } from "express"
import { prisma } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

// Reuse OTP JWT for booking verification
const OTP_JWT_SECRET = process.env.OTP_JWT_SECRET || "otp-dev-secret"

// Book an appointment
router.post("/book", async (req, res) => {
  try {
    const { name, mobileNumber, outletId, serviceTypes, appointmentAt, preferredLanguage, verifiedMobileToken, notes, email, nicNumber } = req.body || {}

    if (!name || !mobileNumber || !outletId || !Array.isArray(serviceTypes) || serviceTypes.length === 0 || !appointmentAt) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Enforce phone verification via OTP (same policy as registration)
    try {
      const payload = (jwt as any).verify(verifiedMobileToken || "", OTP_JWT_SECRET as jwt.Secret) as any
      if (payload?.purpose !== "phone_verification" || payload?.mobileNumber !== mobileNumber) {
        return res.status(403).json({ error: "Phone verification required" })
      }
    } catch {
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
