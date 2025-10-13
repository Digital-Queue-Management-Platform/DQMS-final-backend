import { Router } from "express"
import { prisma, broadcast } from "../server"
import * as jwt from "jsonwebtoken"

const router = Router()

const QR_JWT_SECRET = process.env.JWT_SECRET || "dev-secret"
const QR_JWT_EXPIRES = process.env.QR_JWT_EXPIRES || "5m" // short-lived token

// Issue a short-lived QR token for a given outlet; used to embed in the QR code URL
router.get("/qr-token/:outletId", async (req, res) => {
  try {
    const { outletId } = req.params

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
    if (!outlet || !outlet.isActive) {
      return res.status(404).json({ error: "Outlet not found or inactive" })
    }

    const token = (jwt as any).sign(
      { outletId, purpose: "customer_registration" },
      QR_JWT_SECRET as jwt.Secret,
      { expiresIn: QR_JWT_EXPIRES }
    )

    res.json({ token, expiresIn: QR_JWT_EXPIRES })
  } catch (error) {
    console.error("QR token issue error:", error)
    res.status(500).json({ error: "Failed to issue QR token" })
  }
})

// Validate a QR token (optional convenience endpoint for frontend gating)
router.get("/validate-qr", async (req, res) => {
  try {
    const token = (req.query.token as string) || ""
    if (!token) return res.status(400).json({ valid: false, error: "Missing token" })

    const payload = (jwt as any).verify(token, QR_JWT_SECRET as jwt.Secret) as any
    if (payload?.purpose !== "customer_registration" || !payload?.outletId) {
      return res.status(400).json({ valid: false, error: "Invalid token" })
    }
    res.json({ valid: true, outletId: payload.outletId })
  } catch (error: any) {
    const msg = error?.name === "TokenExpiredError" ? "Token expired" : "Invalid token"
    res.status(401).json({ valid: false, error: msg })
  }
})

// Register customer and create token
router.post("/register", async (req, res) => {
  try {
    const { name, mobileNumber, sltMobileNumber, nicNumber, email, serviceType, outletId, qrToken, preferredLanguages } = req.body

    // Validate input
    if (!name || !mobileNumber || !serviceType || !outletId) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Basic validation for optional fields if provided
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" })
    }
    if (nicNumber && nicNumber.length < 5) {
      return res.status(400).json({ error: "Invalid NIC number" })
    }
    if (sltMobileNumber && !/^0[0-9]{9}$/.test(sltMobileNumber)) {
      return res.status(400).json({ error: "Invalid SLT mobile number" })
    }

    // Enforce QR gating: require a valid QR token bound to this outlet
    if (!qrToken) {
      return res.status(403).json({ error: "QR verification required" })
    }
    try {
      const payload = (jwt as any).verify(qrToken, QR_JWT_SECRET as jwt.Secret) as any
      if (payload?.purpose !== "customer_registration" || payload?.outletId !== outletId) {
        return res.status(403).json({ error: "Invalid QR token for this outlet" })
      }
    } catch (err: any) {
      const msg = err?.name === "TokenExpiredError" ? "QR token expired" : "Invalid QR token"
      return res.status(401).json({ error: msg })
    }

    // Ensure outlet exists & active (prevents FK violation 500s)
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
    if (!outlet || !outlet.isActive) {
      return res.status(404).json({ error: "Outlet not found or inactive" })
    }

    // Find or create customer
    // Try to find customer by primary mobile or NIC/email if provided
    let customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { mobileNumber },
          nicNumber ? { nicNumber } : undefined,
          email ? { email } : undefined,
        ].filter(Boolean) as any,
      },
    })

    if (!customer) {
      try {
        customer = await prisma.customer.create({
          data: { name, mobileNumber, sltMobileNumber, nicNumber, email } as any,
        })
      } catch (err: any) {
        // Handle unique violations gracefully
        if (err?.code === "P2002") {
          return res.status(409).json({ error: `Duplicate value for: ${(err.meta?.target || []).join(", ")}` })
        }
        throw err
      }
    } else {
      // Update missing optional fields if newly provided
      const updateData: any = {}
      const cAny: any = customer
      if (!cAny.sltMobileNumber && sltMobileNumber) updateData.sltMobileNumber = sltMobileNumber
      if (!cAny.nicNumber && nicNumber) updateData.nicNumber = nicNumber
      if (!cAny.email && email) updateData.email = email
      if (Object.keys(updateData).length) {
        try {
          customer = await prisma.customer.update({ where: { id: customer.id }, data: updateData })
        } catch (err: any) {
          if (err?.code === "P2002") {
            return res.status(409).json({ error: `Duplicate value for: ${(err.meta?.target || []).join(", ")}` })
          }
          throw err
        }
      }
    }

    // Normalize preferredLanguages (optional)
    let langs: string[] | undefined
    if (preferredLanguages !== undefined) {
      if (!Array.isArray(preferredLanguages)) {
        return res.status(400).json({ error: 'preferredLanguages must be an array' })
      }
      const allowed = new Set(['en', 'si', 'ta'])
      langs = preferredLanguages.filter((l: any) => typeof l === 'string' && allowed.has(l))
    }

    // Get next token number for outlet
    const lastToken = await prisma.token.findFirst({
      where: { outletId },
      orderBy: { tokenNumber: "desc" },
    })

    const tokenNumber = (lastToken?.tokenNumber || 0) + 1

    // Create token
    const token = await prisma.token.create({
      data: ({
        tokenNumber,
        customerId: customer.id,
        serviceType,
        preferredLanguages: langs ? (langs as any) : undefined,
        outletId,
        status: "waiting",
      } as any),
      include: {
        customer: true,
        outlet: true,
      },
    })

    // Broadcast update
    broadcast({ type: "NEW_TOKEN", data: token })

    res.json({
      success: true,
      token,
      message: "Registration successful",
    })
  } catch (error: any) {
    console.error("Registration error:", error)
    if (error?.code === "P2003") { // FK constraint
      return res.status(400).json({ error: "Invalid reference provided" })
    }
    if (error?.code === "P2025") { // Record not found
      return res.status(404).json({ error: "Related record not found" })
    }
    res.status(500).json({ error: "Registration failed" })
  }
})

// Get token status and waiting time
router.get("/token/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params

    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      include: {
        customer: true,
        outlet: true,
        officer: true,
      },
    })

    if (!token) {
      return res.status(404).json({ error: "Token not found" })
    }

    // Calculate position in queue
    const position = await prisma.token.count({
      where: {
        outletId: token.outletId,
        status: "waiting",
        tokenNumber: { lt: token.tokenNumber },
      },
    })

    // Calculate estimated wait time (5 minutes per person)
    const estimatedWaitMinutes = position * 5

    res.json({
      token,
      position: position + 1,
      estimatedWaitMinutes,
    })
  } catch (error) {
    console.error("Token fetch error:", error)
    res.status(500).json({ error: "Failed to fetch token" })
  }
})

export default router
