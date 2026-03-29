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
    const { 
      name, 
      mobileNumber, 
      outletId, 
      serviceTypes, 
      appointmentAt, 
      preferredLanguage, 
      verifiedMobileToken, 
      notes, 
      email, 
      nicNumber, 
      sltTelephoneNumber, 
      sltTelephoneNumbers, // New array field for multiple numbers
      billPaymentIntent, 
      billPaymentAmount, 
      billPaymentMethod 
    } = req.body || {}

    if (!name || !mobileNumber || !outletId || !Array.isArray(serviceTypes) || serviceTypes.length === 0 || !appointmentAt) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Handle both single and multiple telephone numbers for backward compatibility
    let telephoneNumbersToProcess: string[] = []
    
    if (sltTelephoneNumbers && Array.isArray(sltTelephoneNumbers) && sltTelephoneNumbers.length > 0) {
      telephoneNumbersToProcess = sltTelephoneNumbers
    } else if (sltTelephoneNumber) {
      telephoneNumbersToProcess = [sltTelephoneNumber]
    }

    // Validate telephone numbers if provided
    if (telephoneNumbersToProcess.length > 0) {
      const phoneRegex = /^\d{10}$/
      const invalidNumbers = telephoneNumbersToProcess.filter(num => !phoneRegex.test(num))
      
      if (invalidNumbers.length > 0) {
        return res.status(400).json({
          error: `Invalid telephone numbers. Must be 10 digits: ${invalidNumbers.join(', ')}`
        })
      }

      if (telephoneNumbersToProcess.length > 10) { // Limit to prevent abuse
        return res.status(400).json({
          error: 'Maximum 10 telephone numbers allowed per appointment.'
        })
      }
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

    // Create appointment (keep as 'booked' initially, will be queued based on time)
    const appt = await prisma.$transaction(async (tx) => {
      // Create the appointment
      const newAppointment = await tx.appointment.create({
        data: {
          name,
          mobileNumber,
          outletId,
          serviceTypes,
          preferredLanguage: preferredLanguage || undefined,
          sltTelephoneNumber: sltTelephoneNumber || undefined, // Keep for backward compatibility
          billPaymentIntent: billPaymentIntent || undefined,
          billPaymentAmount: billPaymentIntent === 'partial' ? billPaymentAmount : undefined,
          billPaymentMethod: billPaymentMethod || undefined,
          appointmentAt: new Date(appointmentAt),
          status: 'booked', // Keep as booked initially
          notes: notes || undefined,
        },
      })

      // Create AppointmentBill entries for multiple telephone numbers
      if (telephoneNumbersToProcess.length > 0) {
        for (const phoneNumber of telephoneNumbersToProcess) {
          await tx.appointmentBill.create({
            data: {
              appointmentId: newAppointment.id,
              telephoneNumber: phoneNumber,
              billPaymentIntent: billPaymentIntent || null,
              billPaymentAmount: billPaymentIntent === 'partial' ? billPaymentAmount : null,
            }
          })
        }
      }

      return newAppointment
    }, {
      timeout: 15000, // Increased timeout for multiple telephone number processing
    })

    // Create customer record for future queue processing
    try {
      const existing = await prisma.customer.findFirst({ 
        where: { 
          mobileNumber,
          name 
        } 
      })
      
      if (!existing) {
        await prisma.customer.create({ 
          data: { 
            name, 
            mobileNumber, 
            nicNumber: nicNumber || undefined, 
            email: email || undefined 
          } 
        })
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

// Process pending appointments (called by scheduler)
router.post("/process-pending", async (req, res) => {
  try {
    const now = new Date()
    
    // Find appointments that should be queued (within 2 hours of appointment time)
    const queueWindowMinutes = 120 // 2 hours
    const queueTime = new Date(now.getTime() + queueWindowMinutes * 60 * 1000)
    
    const appointmentsToQueue = await prisma.appointment.findMany({
      where: {
        status: 'booked',
        appointmentAt: {
          lte: queueTime
        }
      }
    })

    const results = {
      queued: 0,
      reminders1h: 0,
      reminders30m: 0,
      errors: 0
    }

    for (const appt of appointmentsToQueue) {
      try {
        const minutesUntilAppt = Math.floor((new Date(appt.appointmentAt).getTime() - now.getTime()) / (1000 * 60))
        
        // Send 1-hour reminder (55-65 minutes before)
        if (minutesUntilAppt >= 55 && minutesUntilAppt <= 65) {
          const outlet = await prisma.outlet.findUnique({ where: { id: appt.outletId } })
          await smsHelper.sendAppointmentReminder(appt.mobileNumber, {
            name: appt.name,
            outletName: outlet?.name || 'SLT Office',
            dateTime: new Date(appt.appointmentAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' }),
            minutesRemaining: minutesUntilAppt
          }, appt.preferredLanguage as 'en' | 'si' | 'ta' || 'en')
          results.reminders1h++
        }
        
        // Send 30-minute reminder (25-35 minutes before)
        if (minutesUntilAppt >= 25 && minutesUntilAppt <= 35) {
          const outlet = await prisma.outlet.findUnique({ where: { id: appt.outletId } })
          await smsHelper.sendAppointmentReminder(appt.mobileNumber, {
            name: appt.name,
            outletName: outlet?.name || 'SLT Office',
            dateTime: new Date(appt.appointmentAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' }),
            minutesRemaining: minutesUntilAppt
          }, appt.preferredLanguage as 'en' | 'si' | 'ta' || 'en')
          results.reminders30m++
        }

        // Add to queue (within 2 hours of appointment)
        if (minutesUntilAppt <= queueWindowMinutes) {
          await addAppointmentToQueue(appt)
          results.queued++
        }
        
      } catch (e) {
        console.error(`Failed to process appointment ${appt.id}:`, e)
        results.errors++
      }
    }

    res.json({ 
      success: true, 
      message: `Processed ${appointmentsToQueue.length} appointments`,
      results 
    })
  } catch (error) {
    console.error("Process pending appointments error:", error)
    res.status(500).json({ error: "Failed to process appointments" })
  }
})

// Helper function to add appointment to queue
async function addAppointmentToQueue(appt: any) {
  const result = await prisma.$transaction(async (tx) => {
    // Find or get customer
    console.log('DEBUG: Appointment check-in - Looking for customer:', {
      mobileNumber: appt.mobileNumber,
      name: appt.name
    })
    
    // Debug: Check all customers with this mobile number
    const allCustomersWithMobile = await tx.customer.findMany({
      where: { mobileNumber: appt.mobileNumber },
      select: { id: true, name: true, mobileNumber: true, createdAt: true }
    })
    console.log('DEBUG: All customers with mobile number:', allCustomersWithMobile)
    
    // Find the most recently created customer with matching mobile number and name
    let customer = await tx.customer.findFirst({ 
      where: { 
        mobileNumber: appt.mobileNumber,
        name: appt.name
      },
      orderBy: { createdAt: 'desc' } // Prioritize recently created customers
    })
    
    // If still no customer found, check if there's a case sensitivity or whitespace issue
    if (!customer) {
      console.log('DEBUG: Exact match not found, trying case-insensitive search')
      const allCustomersWithMobile = await tx.customer.findMany({
        where: { mobileNumber: appt.mobileNumber }
      })
      
      // Try to find a customer with the same name (case-insensitive and trimmed)
      const targetName = appt.name.trim().toLowerCase()
      const matchingCustomer = allCustomersWithMobile.find(c => 
        c.name.trim().toLowerCase() === targetName
      )
      
      if (matchingCustomer) {
        customer = matchingCustomer
        console.log('DEBUG: Found customer via case-insensitive match:', {
          customerId: customer.id,
          exactName: customer.name,
          targetName: appt.name
        })
      }
    }
    
    console.log('DEBUG: Appointment check-in - Found existing customer:', customer ? {
      id: customer.id,
      name: customer.name,
      mobileNumber: customer.mobileNumber,
      matches: {
        nameMatch: customer.name === appt.name,
        mobileMatch: customer.mobileNumber === appt.mobileNumber
      }
    } : null)
    
    // If we found a customer, verify it's the right one
    if (customer && customer.name !== appt.name) {
      console.error('DEBUG: CUSTOMER MISMATCH - Found customer with different name!', {
        expectedName: appt.name,
        actualName: customer.name,
        customerId: customer.id,
        query: { mobileNumber: appt.mobileNumber, name: appt.name }
      })
    }
    
    if (!customer) {
      customer = await tx.customer.create({ 
        data: { 
          name: appt.name, 
          mobileNumber: appt.mobileNumber
        } 
      })
      
      console.log('DEBUG: Appointment check-in - Created new customer:', {
        id: customer.id,
        name: customer.name,
        mobileNumber: customer.mobileNumber
      })
    }

    // Auto-detect priority
    const priorityServices = await tx.$queryRaw`
      SELECT id FROM "Service" WHERE "code" = ANY(${appt.serviceTypes}::text[]) AND "isPriorityService" = true LIMIT 1
    ` as any[]
    const autoPriority = priorityServices.length > 0

    // Get last token number
    const lastReset = getLastDailyReset()
    const lastToken = await tx.token.findFirst({
      where: {
        outletId: appt.outletId,
        createdAt: { gte: lastReset }
      },
      orderBy: { tokenNumber: 'desc' }
    })

    const tokenNumber = lastToken ? lastToken.tokenNumber + 1 : 1

    // Create token
    console.log('DEBUG: Appointment check-in - About to create token with customer:', {
      customerId: customer.id,
      customerName: customer.name,
      customerMobileNumber: customer.mobileNumber,
      appointmentName: appt.name,
      appointmentMobile: appt.mobileNumber
    })
    
    const token = await tx.token.create({
      data: {
        tokenNumber,
        customerId: customer.id,
        serviceTypes: appt.serviceTypes,
        preferredLanguages: appt.preferredLanguage ? [appt.preferredLanguage] : [],
        status: "waiting",
        isPriority: autoPriority,
        outletId: appt.outletId,
        sltTelephoneNumber: appt.sltTelephoneNumber,
        billPaymentIntent: appt.billPaymentIntent,
        billPaymentAmount: appt.billPaymentAmount,
        billPaymentMethod: appt.billPaymentMethod,
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
    
    console.log('DEBUG: Appointment check-in - Token created:', {
      tokenId: token.id,
      tokenNumber: token.tokenNumber,
      customerId: token.customerId,
      customerFromToken: token.customer
    })

    // Transfer bill data from AppointmentBill to TokenBill
    const appointmentBills = await tx.appointmentBill.findMany({
      where: { appointmentId: appt.id }
    })

    console.log('DEBUG: Appointment check-in - Found appointment bills:', {
      count: appointmentBills.length,
      bills: appointmentBills.map(b => ({
        telephoneNumber: b.telephoneNumber,
        billPaymentIntent: b.billPaymentIntent,
        billPaymentAmount: b.billPaymentAmount
      }))
    })

    // Create TokenBill entries for each AppointmentBill
    if (appointmentBills.length > 0) {
      for (const appointmentBill of appointmentBills) {
        await tx.tokenBill.create({
          data: {
            tokenId: token.id,
            telephoneNumber: appointmentBill.telephoneNumber,
            billPaymentIntent: appointmentBill.billPaymentIntent,
            billPaymentAmount: appointmentBill.billPaymentAmount,
          }
        })
      }
      console.log('DEBUG: Appointment check-in - Created TokenBill entries:', appointmentBills.length)
    }

    // Update appointment status and link to token
    await tx.appointment.update({
      where: { id: appt.id },
      data: { 
        status: 'queued',
        tokenId: token.id,
        queuedAt: new Date()
      }
    })

    return token
  }, {
    timeout: 10000
  })

  // Broadcast to officers
  broadcast({ type: 'NEW_TOKEN', data: result })
  
  // Send token SMS to customer
  const outlet = await prisma.outlet.findUnique({ where: { id: appt.outletId } })
  try {
    await smsHelper.sendTokenNotification(appt.mobileNumber, result.tokenNumber, 1, appt.preferredLanguage as 'en' | 'si' | 'ta' || 'en')
  } catch (e) {
    console.error('Failed to send token SMS:', e)
  }
  
  return result
}

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

// DEBUG: Customer lookup test endpoint
router.get("/debug/customers/:mobile", async (req, res) => {
  try {
    const { mobile } = req.params
    const customers = await prisma.customer.findMany({
      where: { mobileNumber: mobile },
      select: { id: true, name: true, mobileNumber: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    })
    
    const tokens = await prisma.token.findMany({
      where: { 
        customer: { mobileNumber: mobile }
      },
      include: { customer: true },
      orderBy: { tokenNumber: 'asc' }
    })
    
    res.json({ 
      mobileNumber: mobile,
      customerCount: customers.length,
      customers, 
      tokenCount: tokens.length,
      tokens: tokens.map(t => ({
        id: t.id,
        tokenNumber: t.tokenNumber,
        status: t.status,
        customerId: t.customerId,
        customerName: t.customer?.name,
        createdAt: t.createdAt
      }))
    })
  } catch (error) {
    console.error("Debug customer lookup error:", error)
    res.status(500).json({ error: "Debug lookup failed", details: error.message })
  }
})

// DEBUG: Test customer query
router.get("/debug/test-query/:mobile/:name", async (req, res) => {
  try {
    const { mobile, name } = req.params
    
    const customer = await prisma.customer.findFirst({ 
      where: { 
        mobileNumber: mobile,
        name: name
      },
      orderBy: { createdAt: 'desc' }
    })
    
    const allCustomersWithMobile = await prisma.customer.findMany({
      where: { mobileNumber: mobile },
      select: { id: true, name: true, mobileNumber: true, createdAt: true },
      orderBy: { createdAt: 'asc' }
    })
    
    res.json({ 
      searchCriteria: { mobileNumber: mobile, name: name },
      foundCustomer: customer ? {
        id: customer.id,
        name: customer.name,
        mobileNumber: customer.mobileNumber,
        createdAt: customer.createdAt
      } : null,
      allCustomersWithMobile
    })
  } catch (error) {
    console.error("Debug test query error:", error)
    res.status(500).json({ error: "Debug test query failed", details: error.message })
  }
})

// DEBUG: Appointment data inspection
router.get("/debug/appointments/:mobile", async (req, res) => {
  try {
    const { mobile } = req.params
    const appointments = await prisma.appointment.findMany({
      where: { mobileNumber: mobile },
      select: { 
        id: true, 
        name: true, 
        mobileNumber: true, 
        status: true,
        appointmentAt: true,
        tokenId: true,
        createdAt: true 
      },
      orderBy: { createdAt: 'asc' }
    })
    
    res.json({ 
      mobileNumber: mobile,
      appointmentCount: appointments.length,
      appointments
    })
  } catch (error) {
    console.error("Debug appointment lookup error:", error)
    res.status(500).json({ error: "Debug appointment lookup failed", details: error.message })
  }
})

// DEBUG: Reset appointments for reprocessing
router.post("/debug/reset-appointments", async (req, res) => {
  try {
    const { mobile } = req.body
    
    // Reset appointment statuses from 'queued' to 'booked' so they can be reprocessed
    const result = await prisma.appointment.updateMany({
      where: { 
        mobileNumber: mobile,
        status: 'queued'
      },
      data: { 
        status: 'booked',
        tokenId: null
      }
    })
    
    res.json({ 
      success: true,
      message: `Reset ${result.count} appointments for mobile ${mobile}`,
      resetCount: result.count
    })
  } catch (error) {
    console.error("Debug reset appointments error:", error)
    res.status(500).json({ error: "Reset failed", details: error.message })
  }
})

export default router
