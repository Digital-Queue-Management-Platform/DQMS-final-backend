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
    const { name, mobileNumber, serviceType, outletId, qrToken, preferredLanguages } = req.body

    console.log(`Registration attempt - Mobile: ${mobileNumber}, Outlet: ${outletId}, Service: ${serviceType}`)

    // Validate input
    if (!name || !mobileNumber || !serviceType || !outletId) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Enforce QR gating: require a valid QR token bound to this outlet
    if (!qrToken) {
      return res.status(403).json({ error: "QR verification required" })
    }

    // Try validating as JWT token first (legacy system)
    let validToken = false
    try {
      const payload = (jwt as any).verify(qrToken, QR_JWT_SECRET as jwt.Secret) as any
      if (payload?.purpose === "customer_registration" && payload?.outletId === outletId) {
        validToken = true
      }
    } catch (err) {
      // JWT validation failed, try manager QR token validation
    }

    // If JWT validation failed, try manager QR token validation
    if (!validToken) {
      if (managerQRTokens.has(qrToken)) {
        const tokenData = managerQRTokens.get(qrToken)!
        
        // Manager tokens are valid until manually refreshed (no automatic expiry)
        // Check if token is for correct outlet
        if (tokenData.outletId === outletId) {
          validToken = true
        } else {
          return res.status(403).json({ error: "QR token is not for this outlet" })
        }
      }
    }

    // If neither validation method worked
    if (!validToken) {
      return res.status(401).json({ error: "Invalid QR token" })
    }

    // Use a database transaction to prevent race conditions
    const token = await prisma.$transaction(async (tx) => {
      // Check if customer already has an active token for this outlet
      const existingToken = await tx.token.findFirst({
        where: {
          outlet: { id: outletId },
          customer: { mobileNumber },
          status: { in: ["waiting", "in_service"] },
        },
        include: {
          customer: true,
          outlet: true,
        },
      })

      if (existingToken) {
        throw new Error(`Customer with mobile number ${mobileNumber} already has an active token (#${existingToken.tokenNumber}) for this outlet`)
      }

      // Find or create customer within transaction
      let customer = await tx.customer.findFirst({
        where: { mobileNumber },
      })

      if (!customer) {
        customer = await tx.customer.create({
          data: { name, mobileNumber },
        })
      }

      // Get next token number for outlet using row-level locking to prevent race conditions
      const lastToken = await tx.token.findFirst({
        where: { outletId },
        orderBy: { tokenNumber: "desc" },
        select: { tokenNumber: true },
      })

      const tokenNumber = (lastToken?.tokenNumber || 0) + 1

      console.log(`Creating token #${tokenNumber} for customer ${name} (${mobileNumber}) at outlet ${outletId}`)

      // Create token within the same transaction
      const newToken = await tx.token.create({
        data: {
          tokenNumber,
          customerId: customer.id,
          serviceType,
          outletId,
          status: "waiting",
          preferredLanguages: preferredLanguages ? JSON.stringify(preferredLanguages) : undefined,
        },
        include: {
          customer: true,
          outlet: true,
        },
      })

      return newToken
    }, {
      timeout: 10000, // 10 second timeout to prevent long-running transactions
    })

    console.log(`Successfully created token #${token.tokenNumber} for customer ${token.customer.name}`)

    // Broadcast update after successful transaction
    broadcast({ type: "NEW_TOKEN", data: token })

    res.json({
      success: true,
      token,
      message: "Registration successful",
    })
  } catch (error: any) {
    console.error("Registration error:", error)
    
    // Handle specific error cases
    if (error.message && error.message.includes("already has an active token")) {
      return res.status(409).json({ error: error.message })
    }
    
    // Handle database constraint violations
    if (error.code === 'P2002') {
      return res.status(409).json({ error: "A registration with this information already exists" })
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

// Shared in-memory store for manager QR tokens (use Redis or database in production)
interface ManagerQRTokenData {
  outletId: string;
  generatedAt: string;
  // Removed expiresAt - tokens don't expire automatically
}

// Use global storage to share between different route files
declare global {
  var globalManagerQRTokens: Map<string, ManagerQRTokenData> | undefined;
}

if (!global.globalManagerQRTokens) {
  global.globalManagerQRTokens = new Map<string, ManagerQRTokenData>();
}

const managerQRTokens = global.globalManagerQRTokens;

// Manager QR Code endpoints
// Register a manager-generated QR token
router.post("/manager-qr-token", async (req, res) => {
  try {
    const { outletId, token, generatedAt } = req.body

    if (!outletId || !token) {
      return res.status(400).json({ error: "Missing outletId or token" })
    }

    // Verify the outlet exists and is active
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
    if (!outlet || !outlet.isActive) {
      return res.status(404).json({ error: "Outlet not found or inactive" })
    }

    // Store the manager QR token (no expiry - valid until manually refreshed)
    managerQRTokens.set(token, {
      outletId,
      generatedAt: generatedAt || new Date().toISOString()
    })

    res.json({ 
      success: true, 
      message: "Manager QR token registered"
    })
  } catch (error) {
    console.error("Manager QR registration error:", error)
    res.status(500).json({ error: "Failed to register manager QR token" })
  }
})

// Validate a manager-generated QR token
router.get("/validate-manager-qr", async (req, res) => {
  try {
    const token = req.query.token as string
    if (!token) {
      return res.status(400).json({ valid: false, error: "Missing token" })
    }

    // Check in-memory store
    if (!managerQRTokens.has(token)) {
      return res.status(400).json({ valid: false, error: "Invalid token" })
    }

    const tokenData = managerQRTokens.get(token)!
    
    // Manager tokens are valid until manually refreshed (no automatic expiry)
    res.json({ 
      valid: true, 
      outletId: tokenData.outletId,
      generatedAt: tokenData.generatedAt
    })
  } catch (error) {
    console.error("Manager QR validation error:", error)
    res.status(500).json({ valid: false, error: "Validation failed" })
  }
})

export default router
