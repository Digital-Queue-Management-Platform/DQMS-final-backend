import { Router, Request, Response } from "express"
import { prisma } from "../server"
import { Prisma } from "@prisma/client"
import { systemLogger } from "../services/systemLogger"

const router = Router()

// Helper to parse date range
const parseDateRange = (from?: string, to?: string) => {
  const result: { gte?: Date; lte?: Date } = {}
  
  if (from) {
    const fromDate = new Date(from)
    if (!isNaN(fromDate.getTime())) {
      result.gte = fromDate
    }
  }
  
  if (to) {
    const toDate = new Date(to)
    if (!isNaN(toDate.getTime())) {
      // Set to end of day
      toDate.setHours(23, 59, 59, 999)
      result.lte = toDate
    }
  }
  
  return Object.keys(result).length > 0 ? result : undefined
}

// ============================================================================
// OVERVIEW PAGE
// ============================================================================
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Total logs today
    const totalLogsToday = await prisma.systemLog.count({
      where: { timestamp: { gte: todayStart } }
    })

    // Total errors today
    const totalErrorsToday = await prisma.systemLog.count({
      where: {
        timestamp: { gte: todayStart },
        level: { in: ['error', 'fatal'] }
      }
    })

    // Total warnings today
    const totalWarningsToday = await prisma.systemLog.count({
      where: {
        timestamp: { gte: todayStart },
        level: 'warn'
      }
    })

    // Offline devices
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
    const offlineDevices = await prisma.deviceHeartbeat.count({
      where: {
        OR: [
          { status: 'offline' },
          { lastSeenAt: { lt: twoMinutesAgo } }
        ]
      }
    })

    // WebSocket failures today
    const websocketFailuresToday = await prisma.systemLog.count({
      where: {
        timestamp: { gte: todayStart },
        OR: [
          { event: { contains: 'websocket' } },
          { event: { contains: 'disconnect' } },
          { module: 'websocket' }
        ],
        level: { in: ['error', 'warn'] }
      }
    })

    // Audio failures today
    const audioFailuresToday = await prisma.systemLog.count({
      where: {
        timestamp: { gte: todayStart },
        event: { contains: 'audio' },
        level: { in: ['error', 'warn'] }
      }
    })

    // Failed deployments
    const failedDeployments = await prisma.deploymentLog.count({
      where: { status: 'failed' }
    })

    // Critical errors today
    const criticalErrors = await prisma.systemLog.count({
      where: {
        timestamp: { gte: todayStart },
        level: 'fatal'
      }
    })

    // Error count by hour (last 24 hours)
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const errorsByHour = await prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
      SELECT 
        EXTRACT(HOUR FROM timestamp) as hour,
        COUNT(*) as count
      FROM "SystemLog"
      WHERE timestamp >= ${last24Hours}
        AND level IN ('error', 'fatal')
      GROUP BY EXTRACT(HOUR FROM timestamp)
      ORDER BY hour
    `

    // Logs by severity (last 7 days)
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const logsBySeverity = await prisma.systemLog.groupBy({
      by: ['level'],
      where: { timestamp: { gte: last7Days } },
      _count: { id: true }
    })

    // Most affected outlets (last 7 days)
    const mostAffectedOutlets = await prisma.systemLog.groupBy({
      by: ['outletId'],
      where: {
        timestamp: { gte: last7Days },
        level: { in: ['error', 'fatal'] },
        outletId: { not: null }
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5
    })

    // Populate outlet names
    const outletIds = mostAffectedOutlets.map(o => o.outletId).filter((id): id is string => id !== null)
    const outlets = await prisma.outlet.findMany({
      where: { id: { in: outletIds } },
      select: { id: true, name: true, location: true }
    })

    const outletMap = new Map(outlets.map(o => [o.id, o]))
    const mostAffectedOutletsWithNames = mostAffectedOutlets.map(o => ({
      outletId: o.outletId,
      outlet: o.outletId ? outletMap.get(o.outletId) : null,
      errorCount: o._count.id
    }))

    // Most affected modules (last 7 days)
    const mostAffectedModules = await prisma.systemLog.groupBy({
      by: ['module'],
      where: {
        timestamp: { gte: last7Days },
        level: { in: ['error', 'fatal'] },
        module: { not: null }
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5
    })

    // Device online vs offline count
    const onlineDevices = await prisma.deviceHeartbeat.count({
      where: {
        status: 'online',
        lastSeenAt: { gte: twoMinutesAgo }
      }
    })

    // Recent critical events
    const recentCriticalEvents = await prisma.systemLog.findMany({
      where: {
        level: { in: ['error', 'fatal'] }
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
      include: {
        outlet: { select: { name: true, location: true } }
      }
    })

    res.json({
      summary: {
        totalLogsToday,
        totalErrorsToday,
        totalWarningsToday,
        offlineDevices,
        websocketFailuresToday,
        audioFailuresToday,
        failedDeployments,
        criticalErrors
      },
      errorsByHour: errorsByHour.map(row => ({
        hour: Number(row.hour),
        count: Number(row.count)
      })),
      logsBySeverity: logsBySeverity.map(log => ({
        level: log.level,
        count: log._count.id
      })),
      mostAffectedOutlets: mostAffectedOutletsWithNames,
      mostAffectedModules: mostAffectedModules.map(m => ({
        module: m.module,
        errorCount: m._count.id
      })),
      deviceStats: {
        online: onlineDevices,
        offline: offlineDevices,
        total: onlineDevices + offlineDevices
      },
      recentCriticalEvents
    })
  } catch (error) {
    console.error("Error fetching overview:", error)
    res.status(500).json({ error: "Failed to fetch overview data" })
  }
})

// ============================================================================
// APPLICATION LOGS
// ============================================================================
router.get("/application", async (req: Request, res: Response) => {
  try {
    const {
      level,
      service,
      module,
      role,
      branchId,
      outletId,
      userId,
      event,
      search,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50',
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: Prisma.SystemLogWhereInput = {}

    if (level) where.level = level as string
    if (service) where.service = service as string
    if (module) where.module = module as string
    if (role) where.userRole = role as string
    if (outletId) where.outletId = outletId as string
    if (userId) where.userId = userId as string
    if (event) where.event = event as string

    if (search) {
      where.OR = [
        { message: { contains: search as string, mode: 'insensitive' } },
        { event: { contains: search as string, mode: 'insensitive' } },
        { module: { contains: search as string, mode: 'insensitive' } }
      ]
    }

    const dateRange = parseDateRange(dateFrom as string, dateTo as string)
    if (dateRange) {
      where.timestamp = dateRange
    }

    // Build order by
    const orderBy: any = {}
    orderBy[sortBy as string] = sortOrder

    // Fetch logs
    const [logs, total] = await Promise.all([
      prisma.systemLog.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include: {
          outlet: { select: { name: true, location: true } },
          region: { select: { name: true } }
        }
      }),
      prisma.systemLog.count({ where })
    ])

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error("Error fetching application logs:", error)
    res.status(500).json({ error: "Failed to fetch application logs" })
  }
})

// ============================================================================
// DEVICE LOGS
// ============================================================================
router.get("/devices", async (req: Request, res: Response) => {
  try {
    const {
      deviceType,
      deviceId,
      outletId,
      level,
      onlineStatus,
      search,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50',
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: Prisma.SystemLogWhereInput = {
      deviceId: { not: null }
    }

    if (deviceType) {
      where.service = { in: [deviceType as string, `${deviceType}-ui`] }
    }
    if (deviceId) where.deviceId = deviceId as string
    if (outletId) where.outletId = outletId as string
    if (level) where.level = level as string

    if (search) {
      where.OR = [
        { message: { contains: search as string, mode: 'insensitive' } },
        { event: { contains: search as string, mode: 'insensitive' } },
        { deviceId: { contains: search as string, mode: 'insensitive' } }
      ]
    }

    const dateRange = parseDateRange(dateFrom as string, dateTo as string)
    if (dateRange) {
      where.timestamp = dateRange
    }

    // Build order by
    const orderBy: any = {}
    orderBy[sortBy as string] = sortOrder

    // Fetch device logs
    const [logs, total] = await Promise.all([
      prisma.systemLog.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include: {
          outlet: { select: { name: true, location: true } }
        }
      }),
      prisma.systemLog.count({ where })
    ])

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error("Error fetching device logs:", error)
    res.status(500).json({ error: "Failed to fetch device logs" })
  }
})

// ============================================================================
// WEBSOCKET / REALTIME LOGS
// ============================================================================
router.get("/realtime", async (req: Request, res: Response) => {
  try {
    const {
      outletId,
      event,
      level,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50'
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause for WebSocket-related logs
    const where: Prisma.SystemLogWhereInput = {
      OR: [
        { module: 'websocket' },
        { event: { contains: 'websocket' } },
        { event: { contains: 'connect' } },
        { event: { contains: 'disconnect' } },
        { event: { contains: 'broadcast' } }
      ]
    }

    if (outletId) where.outletId = outletId as string
    if (level) where.level = level as string
    if (event) where.event = event as string

    const dateRange = parseDateRange(dateFrom as string, dateTo as string)
    if (dateRange) {
      where.timestamp = dateRange
    }

    // Fetch logs
    const [logs, total] = await Promise.all([
      prisma.systemLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum,
        include: {
          outlet: { select: { name: true, location: true } }
        }
      }),
      prisma.systemLog.count({ where })
    ])

    // Quick stats
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0))
    const [disconnectsToday, reconnectsToday, failedBroadcastsToday] = await Promise.all([
      prisma.systemLog.count({
        where: {
          timestamp: { gte: todayStart },
          event: { contains: 'disconnect' }
        }
      }),
      prisma.systemLog.count({
        where: {
          timestamp: { gte: todayStart },
          event: { contains: 'reconnect' }
        }
      }),
      prisma.systemLog.count({
        where: {
          timestamp: { gte: todayStart },
          event: { contains: 'broadcast' },
          level: 'error'
        }
      })
    ])

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      },
      stats: {
        disconnectsToday,
        reconnectsToday,
        failedBroadcastsToday
      }
    })
  } catch (error) {
    console.error("Error fetching realtime logs:", error)
    res.status(500).json({ error: "Failed to fetch realtime logs" })
  }
})

// ============================================================================
// DEPLOYMENT LOGS
// ============================================================================
router.get("/deployments", async (req: Request, res: Response) => {
  try {
    const {
      service,
      status,
      environment,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50'
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: Prisma.DeploymentLogWhereInput = {}

    if (service) where.service = service as string
    if (status) where.status = status as string
    if (environment) where.environment = environment as string

    const dateRange = parseDateRange(dateFrom as string, dateTo as string)
    if (dateRange) {
      where.timestamp = dateRange
    }

    // Fetch deployment logs
    const [logs, total] = await Promise.all([
      prisma.deploymentLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.deploymentLog.count({ where })
    ])

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error("Error fetching deployment logs:", error)
    res.status(500).json({ error: "Failed to fetch deployment logs" })
  }
})

// ============================================================================
// AUDIT LOGS
// ============================================================================
router.get("/audit", async (req: Request, res: Response) => {
  try {
    const {
      userId,
      userRole,
      action,
      outletId,
      regionId,
      dateFrom,
      dateTo,
      page = '1',
      limit = '50'
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: Prisma.AuditLogWhereInput = {}

    if (userId) where.userId = userId as string
    if (userRole) where.userRole = userRole as string
    if (action) where.action = action as string
    if (outletId) where.outletId = outletId as string
    if (regionId) where.regionId = regionId as string

    const dateRange = parseDateRange(dateFrom as string, dateTo as string)
    if (dateRange) {
      where.timestamp = dateRange
    }

    // Fetch audit logs
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum,
        include: {
          outlet: { select: { name: true, location: true } },
          region: { select: { name: true } }
        }
      }),
      prisma.auditLog.count({ where })
    ])

    res.json({
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error("Error fetching audit logs:", error)
    res.status(500).json({ error: "Failed to fetch audit logs" })
  }
})

// ============================================================================
// DEVICE HEALTH
// ============================================================================
router.get("/device-health", async (req: Request, res: Response) => {
  try {
    const {
      deviceType,
      outletId,
      status,
      page = '1',
      limit = '50'
    } = req.query

    const pageNum = Math.max(1, parseInt(page as string))
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)))
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: Prisma.DeviceHeartbeatWhereInput = {}

    if (deviceType) where.deviceType = deviceType as string
    if (outletId) where.outletId = outletId as string
    if (status) where.status = status as string

    // Auto-detect offline devices (no heartbeat for 2+ minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)

    // Fetch devices
    const [devices, total] = await Promise.all([
      prisma.deviceHeartbeat.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          outlet: { select: { name: true, location: true, regionId: true } }
        }
      }),
      prisma.deviceHeartbeat.count({ where })
    ])

    // Calculate actual status based on lastSeenAt
    const devicesWithStatus = devices.map(device => {
      const isOnline = device.lastSeenAt >= twoMinutesAgo
      const actualStatus = isOnline ? device.status : 'offline'

      return {
        ...device,
        actualStatus,
        isOnline
      }
    })

    // Summary stats
    const onlineCount = await prisma.deviceHeartbeat.count({
      where: { lastSeenAt: { gte: twoMinutesAgo } }
    })

    const offlineCount = await prisma.deviceHeartbeat.count({
      where: { lastSeenAt: { lt: twoMinutesAgo } }
    })

    const degradedCount = await prisma.deviceHeartbeat.count({
      where: {
        status: 'degraded',
        lastSeenAt: { gte: twoMinutesAgo }
      }
    })

    const pollingModeCount = await prisma.deviceHeartbeat.count({
      where: {
        pollingMode: true,
        lastSeenAt: { gte: twoMinutesAgo }
      }
    })

    res.json({
      devices: devicesWithStatus,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      },
      summary: {
        online: onlineCount,
        offline: offlineCount,
        degraded: degradedCount,
        pollingMode: pollingModeCount,
        total: onlineCount + offlineCount
      }
    })
  } catch (error) {
    console.error("Error fetching device health:", error)
    res.status(500).json({ error: "Failed to fetch device health" })
  }
})

// ============================================================================
// GET SINGLE LOG DETAILS
// ============================================================================
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const log = await prisma.systemLog.findUnique({
      where: { id },
      include: {
        outlet: { select: { name: true, location: true } },
        region: { select: { name: true } }
      }
    })

    if (!log) {
      return res.status(404).json({ error: "Log not found" })
    }

    res.json(log)
  } catch (error) {
    console.error("Error fetching log details:", error)
    res.status(500).json({ error: "Failed to fetch log details" })
  }
})

// ============================================================================
// CLIENT LOG INGESTION
// ============================================================================
router.post("/ingest", async (req: Request, res: Response) => {
  try {
    const {
      level,
      service,
      module,
      event,
      message,
      stackTrace,
      metadata,
      userId,
      userRole,
      outletId,
      regionId,
      deviceId,
      sessionId,
      requestId,
      appVersion,
      ipAddress,
      userAgent
    } = req.body

    // Validate required fields
    if (!level || !service || !message) {
      return res.status(400).json({ error: "Missing required fields: level, service, message" })
    }

    // Create log entry
    const log = await prisma.systemLog.create({
      data: {
        level,
        service,
        module,
        event,
        message,
        stackTrace,
        metadata,
        userId,
        userRole,
        outletId,
        regionId,
        deviceId,
        sessionId,
        requestId,
        appVersion,
        ipAddress,
        userAgent
      }
    })

    res.status(201).json({ success: true, logId: log.id })
  } catch (error) {
    console.error("Error ingesting log:", error)
    res.status(500).json({ error: "Failed to ingest log" })
  }
})

// ============================================================================
// DEVICE HEARTBEAT
// ============================================================================
router.post("/heartbeat", async (req: Request, res: Response) => {
  try {
    const {
      deviceId,
      deviceType,
      outletId,
      status = 'online',
      appVersion,
      websocketConnected = false,
      pollingMode = false,
      ipAddress,
      metadata
    } = req.body

    // Validate required fields
    if (!deviceId || !deviceType || !outletId) {
      return res.status(400).json({ error: "Missing required fields: deviceId, deviceType, outletId" })
    }

    // Upsert heartbeat
    const heartbeat = await prisma.deviceHeartbeat.upsert({
      where: { deviceId },
      update: {
        status,
        appVersion,
        websocketConnected,
        pollingMode,
        ipAddress,
        metadata,
        lastSeenAt: new Date()
      },
      create: {
        deviceId,
        deviceType,
        outletId,
        status,
        appVersion,
        websocketConnected,
        pollingMode,
        ipAddress,
        metadata,
        lastSeenAt: new Date()
      }
    })

    res.json({ success: true, heartbeat })
  } catch (error) {
    console.error("Error updating heartbeat:", error)
    res.status(500).json({ error: "Failed to update heartbeat" })
  }
})

// ============================================================================
// CREATE AUDIT LOG
// ============================================================================
router.post("/audit", async (req: Request, res: Response) => {
  try {
    const {
      userId,
      userRole,
      action,
      targetType,
      targetId,
      outletId,
      regionId,
      changes,
      metadata,
      message,
      ipAddress
    } = req.body

    // Validate required fields
    if (!userId || !userRole || !action || !message) {
      return res.status(400).json({ error: "Missing required fields: userId, userRole, action, message" })
    }

    // Create audit log
    const auditLog = await prisma.auditLog.create({
      data: {
        userId,
        userRole,
        action,
        targetType,
        targetId,
        outletId,
        regionId,
        changes,
        metadata,
        message,
        ipAddress
      }
    })

    res.status(201).json({ success: true, auditLogId: auditLog.id })
  } catch (error) {
    console.error("Error creating audit log:", error)
    res.status(500).json({ error: "Failed to create audit log" })
  }
})

// Voice failure logging endpoint for display dashboards
router.post("/voice-failure", async (req: Request, res: Response) => {
  const { tokenNumber, lang, error, timestamp } = req.body
  
  try {
    await systemLogger.error(`Voice announcement failed for token ${tokenNumber}`, {
      service: 'frontend',
      module: 'outlet-display',
      event: 'voice-failure',
      metadata: {
        tokenNumber,
        language: lang || 'unknown',
        error,
        timestamp,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.connection?.remoteAddress
      }
    })
    res.json({ success: true })
  } catch (err) {
    console.error('Failed to log voice failure:', err)
    res.status(500).json({ error: 'Logging failed' })
  }
})

export default router
