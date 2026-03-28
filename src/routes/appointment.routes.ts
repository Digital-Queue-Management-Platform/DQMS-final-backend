import { Router } from "express"
import { prisma, broadcast } from "../server"
import * as jwt from "jsonwebtoken"
import smsHelper from "../utils/smsHelper"
import { getLastDailyReset } from "../utils/resetWindow"

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
    // First fetch the system setting
    const settingRows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting"
      WHERE "key" = 'advanced_appointment_required'
      LIMIT 1
    `
    const isAdvancedRequired = settingRows[0]?.booleanValue ?? true

    if (isAdvancedRequired) {
      const appointmentDate = new Date(appointmentAt)
      const now = new Date()
      const hoursUntilAppointment = (appointmentDate.getTime() - now.getTime()) / (1000 * 60 * 60)
      if (hoursUntilAppointment < 24) {
        return res.status(400).json({ error: "Appointments must be booked at least 24 hours in advance" })
      }
    } else {
      const appointmentDate = new Date(appointmentAt)
      if (appointmentDate.getTime() < Date.now()) {
        return res.status(400).json({ error: "Appointments cannot be booked in the past" })
      }
    }

    // Create appointment and automatically add to queue
    const result = await prisma.$transaction(async (tx) => {
      // Create appointment
      const appt = await tx.appointment.create({
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
          status: 'queued',
          notes: notes || undefined,
        },
      })

      // Find or create customer with the appointment name
      let customer = await tx.customer.findFirst({ 
        where: { 
          mobileNumber,
          name // Match both mobile and name to avoid duplicate entries
        } 
      })
      
      if (!customer) {
        customer = await tx.customer.create({ 
          data: { 
            name, 
            mobileNumber, 
            nicNumber: nicNumber || undefined, 
            email: email || undefined 
          } 
        })
      }

      // Auto-detect priority based on service types
      const priorityServices = await tx.$queryRaw`
        SELECT id FROM "Service" WHERE "code" = ANY(${serviceTypes}::text[]) AND "isPriorityService" = true LIMIT 1
      ` as any[]
      const autoPriority = priorityServices.length > 0

      // Get last token number to generate next token
      const lastReset = getLastDailyReset()
      const lastToken = await tx.token.findFirst({
        where: {
          outletId,
          createdAt: { gte: lastReset }
        },
        orderBy: { tokenNumber: 'desc' }
      })

      const tokenNumber = lastToken ? lastToken.tokenNumber + 1 : 1

      // Create token (add to queue) with appointment details
      const token = await tx.token.create({
        data: {
          tokenNumber,
          customerId: customer.id,
          serviceTypes,
          preferredLanguages: preferredLanguage ? [preferredLanguage] : [],
          status: "waiting",
          isPriority: autoPriority,
          outletId: outletId,
          sltTelephoneNumber: sltTelephoneNumber?.trim() || null,
          billPaymentIntent: billPaymentIntent || null,
          billPaymentAmount: billPaymentIntent === 'partial' ? billPaymentAmount : null,
          billPaymentMethod: billPaymentMethod || null,
        },
        include: {
          customer: {
            select: {
              name: true,
              mobileNumber: true
            }
          }
        }
      })

      // Link appointment to token
      await tx.appointment.update({
        where: { id: appt.id },
        data: { tokenId: token.id }
      })

      return { appt, token }
    }, {
      timeout: 10000
    })

    const { appt, token } = result

    // Broadcast new token to officers queue system
    broadcast({ type: 'NEW_TOKEN', data: token })

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
    const appts = await prisma.appointment.findMany({
      where: { mobileNumber },
      include: {
        outlet: {
          select: {
            name: true,
            location: true
          }
        }
      },
      orderBy: { appointmentAt: 'asc' }
    })

    // For queued appointments, fetch token details and calculate queue position
    const enrichedAppts = await Promise.all(appts.map(async (appt) => {
      let tokenInfo = null
      let queueInfo = null
      
      if (appt.status === 'queued' && appt.tokenId) {
        try {
          // Get token details
          const token = await prisma.token.findUnique({
            where: { id: appt.tokenId },
            select: {
              id: true,
              tokenNumber: true,
              status: true,
              createdAt: true,
              customer: {
                select: {
                  name: true
                }
              }
            }
          })
          
          if (token) {
            tokenInfo = token
            
            // Calculate queue position
            const lastReset = getLastDailyReset()
            const waitingAhead = await prisma.token.count({
              where: {
                outletId: appt.outletId,
                status: 'waiting',
                tokenNumber: { lt: token.tokenNumber },
                createdAt: { gte: lastReset }
              }
            })
            
            const estimatedWaitMinutes = Math.max(5, waitingAhead * 5)
            
            queueInfo = {
              position: waitingAhead + 1,
              estimatedWaitMinutes
            }
          }
        } catch (e) {
          console.error('Failed to fetch token info:', e)
        }
      }
      
      return {
        ...appt,
        token: tokenInfo,
        queueInfo
      }
    }))

    res.json({ appointments: enrichedAppts, now: now.toISOString() })
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
    const startDate = req.query.startDate as string | undefined
    const endDate = req.query.endDate as string | undefined

    let dateStart: Date | undefined
    let dateEnd: Date | undefined

    if (startDate && endDate) {
      dateStart = new Date(startDate)
      dateStart.setHours(0, 0, 0, 0)
      dateEnd = new Date(endDate)
      dateEnd.setHours(23, 59, 59, 999)
    } else if (date) {
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

// Cancel an appointment
router.post("/:apptId/cancel", async (req, res) => {
  try {
    const { apptId } = req.params

    const appt = await prisma.appointment.findUnique({
      where: { id: apptId },
    })

    if (!appt) {
      return res.status(404).json({ error: "Appointment not found" })
    }

    if (appt.status !== 'booked') {
      return res.status(400).json({ error: "Only booked appointments can be cancelled" })
    }

    const updatedAppt = await prisma.appointment.update({
      where: { id: apptId },
      data: { status: 'cancelled' },
    })

    // Send Cancellation SMS
    try {
      const outlet = await prisma.outlet.findUnique({ where: { id: appt.outletId } })
      const when = new Date(appt.appointmentAt)
      const whenStr = when.toLocaleString('en-GB', {
        timeZone: 'Asia/Colombo',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })

      const lang: 'en' | 'si' | 'ta' = (appt.preferredLanguage === 'si' || appt.preferredLanguage === 'ta') ? appt.preferredLanguage : 'en'

      await smsHelper.sendAppointmentCancellation(appt.mobileNumber, {
        outletName: outlet?.name || 'SLT Office',
        dateTime: whenStr,
      }, lang)
    } catch (smsErr) {
      console.error("Failed to send cancellation SMS:", smsErr)
    }

    res.json({ success: true, message: "Appointment cancelled", appointment: updatedAppt })
  } catch (error) {
    console.error("Appointment cancel error:", error)
    res.status(500).json({ error: "Failed to cancel appointment" })
  }
})

// Check-in an appointment (convert to token)
router.post("/:apptId/checkin", async (req, res) => {
  try {
    const { apptId } = req.params

    // Find the appointment
    const appt = await prisma.appointment.findUnique({
      where: { id: apptId },
      include: {
        outlet: true
      }
    })

    if (!appt) {
      return res.status(404).json({ error: "Appointment not found" })
    }

    if (appt.status !== 'booked') {
      return res.status(400).json({ error: "Only booked appointments can be checked in" })
    }

    // Check if appointment already has a token
    if (appt.tokenId) {
      return res.status(400).json({ error: "Appointment already checked in" })
    }

    // Check priority service setting
    const prioritySettingRows = await prisma.$queryRaw<{ booleanValue: boolean | null }[]>`
      SELECT "booleanValue" FROM "AppSetting" WHERE "key" = 'priority_service_enabled' LIMIT 1
    `
    const priorityFeatureEnabled = prioritySettingRows[0]?.booleanValue ?? true

    const priorityServices = await prisma.$queryRaw`
      SELECT id FROM "Service" WHERE "code" = ANY(${appt.serviceTypes}::text[]) AND "isPriorityService" = true LIMIT 1
    ` as any[]
    const autoPriority = priorityFeatureEnabled && priorityServices.length > 0

    // Create customer and token using appointment data
    const token = await prisma.$transaction(async (tx) => {
      // Create customer record using appointment name and mobile
      const customer = await tx.customer.create({
        data: {
          name: appt.name,
          mobileNumber: appt.mobileNumber,
        }
      })

      // Lock outlet for token number generation
      await tx.$executeRaw`SELECT id FROM "Outlet" WHERE id = ${appt.outletId} FOR UPDATE`

      // Get next token number
      const lastReset = getLastDailyReset()
      const lastToken = await tx.token.findFirst({
        where: { outletId: appt.outletId, createdAt: { gte: lastReset } },
        orderBy: { tokenNumber: 'desc' }
      })

      const tokenNumber = lastToken ? lastToken.tokenNumber + 1 : 1

      // Create token with appointment data
      const newToken = await tx.token.create({
        data: {
          tokenNumber,
          customerId: customer.id,
          serviceTypes: appt.serviceTypes,
          outletId: appt.outletId,
          status: "waiting",
          isPriority: autoPriority,
          preferredLanguages: appt.preferredLanguage ? [appt.preferredLanguage] : undefined,
          sltTelephoneNumber: appt.sltTelephoneNumber || null,
          billPaymentIntent: appt.billPaymentIntent || null,
          billPaymentAmount: appt.billPaymentAmount || null,
          billPaymentMethod: appt.billPaymentMethod || null,
        },
        include: {
          customer: true,
          outlet: true,
        }
      })

      // Update appointment with token reference and status
      await tx.appointment.update({
        where: { id: apptId },
        data: {
          tokenId: newToken.id,
          status: 'queued',
          queuedAt: new Date()
        }
      })

      return newToken
    }, { timeout: 10000 })

    // Broadcast new token to queue
    broadcast({ type: 'NEW_TOKEN', data: token })

    console.log(`[APPT-CHECKIN] Appointment ${apptId} checked in as token #${token.tokenNumber}`)

    res.json({
      success: true,
      message: "Appointment checked in successfully",
      token: {
        id: token.id,
        tokenNumber: token.tokenNumber,
        customerName: token.customer.name,
        outletName: token.outlet.name,
        serviceTypes: token.serviceTypes,
        status: token.status,
        createdAt: token.createdAt
      }
    })

  } catch (error) {
    console.error("Appointment check-in error:", error)
    res.status(500).json({ error: "Failed to check in appointment" })
  }
})

export default router
