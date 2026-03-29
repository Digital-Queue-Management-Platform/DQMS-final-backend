/**
 * System Logging Service - Centralized Logging Infrastructure
 * 
 * This service provides structured logging to the database for
 * monitoring, debugging, and system diagnostics.
 */

import { prisma } from "../server"

// Log levels in order of severity
export type LogLevel = 'info' | 'warn' | 'error' | 'fatal'

export interface LogContext {
  service?: string
  module?: string
  event?: string
  userId?: string
  userRole?: string
  outletId?: string
  regionId?: string
  deviceId?: string
  sessionId?: string
  requestId?: string
  appVersion?: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
  stackTrace?: string
}

class SystemLogger {
  private batchQueue: Array<{
    level: LogLevel
    message: string
    context: LogContext
    timestamp: Date
  }> = []
  
  private batchTimer: NodeJS.Timeout | null = null
  private readonly BATCH_SIZE = 20
  private readonly BATCH_INTERVAL = 5000 // 5 seconds
  
  constructor() {
    // Start batch processing
    this.startBatchProcessor()
  }
  
  private startBatchProcessor() {
    this.batchTimer = setInterval(() => {
      this.flushBatch()
    }, this.BATCH_INTERVAL)
  }
  
  private async flushBatch() {
    if (this.batchQueue.length === 0) return
    
    const toProcess = this.batchQueue.splice(0, this.BATCH_SIZE)
    
    try {
      await prisma.systemLog.createMany({
        data: toProcess.map(log => ({
          timestamp: log.timestamp,
          level: log.level,
          service: log.context.service || 'backend',
          module: log.context.module,
          event: log.context.event,
          message: log.message,
          stackTrace: log.context.stackTrace,
          metadata: log.context.metadata as any,
          userId: log.context.userId,
          userRole: log.context.userRole,
          outletId: log.context.outletId,
          regionId: log.context.regionId,
          deviceId: log.context.deviceId,
          sessionId: log.context.sessionId,
          requestId: log.context.requestId,
          appVersion: log.context.appVersion,
          ipAddress: log.context.ipAddress,
          userAgent: log.context.userAgent,
        }))
      })
    } catch (error) {
      // Fallback to console if database logging fails
      console.error('[SystemLogger] Failed to flush batch:', error)
      toProcess.forEach(log => {
        console.error(`[${log.level.toUpperCase()}] ${log.message}`, log.context)
      })
    }
  }
  
  private addToQueue(level: LogLevel, message: string, context: LogContext) {
    this.batchQueue.push({
      level,
      message,
      context,
      timestamp: new Date()
    })
    
    // Flush immediately for critical logs
    if (level === 'fatal' || level === 'error') {
      this.flushBatch()
    } else if (this.batchQueue.length >= this.BATCH_SIZE) {
      this.flushBatch()
    }
  }
  
  info(message: string, context: LogContext = {}) {
    this.addToQueue('info', message, context)
  }
  
  warn(message: string, context: LogContext = {}) {
    this.addToQueue('warn', message, context)
  }
  
  error(message: string, context: LogContext = {}) {
    this.addToQueue('error', message, context)
  }
  
  fatal(message: string, context: LogContext = {}) {
    this.addToQueue('fatal', message, context)
  }
  
  // Log from an Error object
  logError(error: Error, context: LogContext = {}) {
    this.error(error.message, {
      ...context,
      stackTrace: error.stack
    })
  }
  
  // Log WebSocket events
  wsEvent(event: string, message: string, context: LogContext = {}) {
    this.addToQueue('info', message, {
      ...context,
      module: 'websocket',
      event
    })
  }
  
  wsError(event: string, message: string, context: LogContext = {}) {
    this.addToQueue('error', message, {
      ...context,
      module: 'websocket',
      event
    })
  }
  
  // Create audit log entry (for business actions)
  async audit(
    userId: string,
    userRole: string,
    action: string,
    message: string,
    options: {
      targetType?: string
      targetId?: string
      outletId?: string
      regionId?: string
      changes?: Record<string, unknown>
      metadata?: Record<string, unknown>
      ipAddress?: string
    } = {}
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          userRole,
          action,
          message,
          targetType: options.targetType,
          targetId: options.targetId,
          outletId: options.outletId,
          regionId: options.regionId,
          changes: options.changes as any,
          metadata: options.metadata as any,
          ipAddress: options.ipAddress
        }
      })
    } catch (error) {
      console.error('[SystemLogger] Failed to create audit log:', error)
    }
  }
  
  // Log deployment event
  async logDeployment(
    service: string,
    status: 'pending' | 'in-progress' | 'success' | 'failed',
    options: {
      environment?: string
      branch?: string
      commitHash?: string
      triggeredBy?: string
      duration?: number
      output?: string
      errorMessage?: string
      notes?: string
    } = {}
  ) {
    try {
      await prisma.deploymentLog.create({
        data: {
          service,
          status,
          environment: options.environment || 'production',
          branch: options.branch,
          commitHash: options.commitHash,
          triggeredBy: options.triggeredBy,
          duration: options.duration,
          output: options.output,
          errorMessage: options.errorMessage,
          notes: options.notes
        }
      })
    } catch (error) {
      console.error('[SystemLogger] Failed to create deployment log:', error)
    }
  }
  
  // Update device heartbeat
  async heartbeat(
    deviceId: string,
    deviceType: string,
    outletId: string,
    options: {
      status?: 'online' | 'offline' | 'degraded'
      appVersion?: string
      websocketConnected?: boolean
      pollingMode?: boolean
      ipAddress?: string
      metadata?: Record<string, unknown>
    } = {}
  ) {
    try {
      await prisma.deviceHeartbeat.upsert({
        where: { deviceId },
        update: {
          status: options.status || 'online',
          appVersion: options.appVersion,
          websocketConnected: options.websocketConnected ?? false,
          pollingMode: options.pollingMode ?? false,
          ipAddress: options.ipAddress,
          metadata: options.metadata as any,
          lastSeenAt: new Date()
        },
        create: {
          deviceId,
          deviceType,
          outletId,
          status: options.status || 'online',
          appVersion: options.appVersion,
          websocketConnected: options.websocketConnected ?? false,
          pollingMode: options.pollingMode ?? false,
          ipAddress: options.ipAddress,
          metadata: options.metadata as any
        }
      })
    } catch (error) {
      console.error('[SystemLogger] Failed to update heartbeat:', error)
    }
  }
  
  // Clean shutdown
  async shutdown() {
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
    }
    await this.flushBatch()
  }
}

// Export singleton instance
export const systemLogger = new SystemLogger()

// Express middleware for request logging
export const requestLoggerMiddleware = (
  req: any,
  res: any,
  next: () => void
) => {
  const startTime = Date.now()
  
  // Generate request ID
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  req.requestId = requestId
  
  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime
    const statusCode = res.statusCode
    
    // Only log errors and slow requests (>2s)
    if (statusCode >= 400 || duration > 2000) {
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
      const logMessage = `${req.method} ${req.path} ${statusCode} ${duration}ms`
      const logContext = {
        service: 'backend',
        module: 'api',
        event: statusCode >= 500 ? 'server-error' : statusCode >= 400 ? 'client-error' : 'slow-request',
        requestId,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent'],
        metadata: {
          method: req.method,
          path: req.path,
          query: req.query,
          statusCode,
          duration,
          headers: {
            'content-type': req.headers['content-type'],
            'accept': req.headers['accept']
          }
        }
      }
      
      if (level === 'error') {
        systemLogger.error(logMessage, logContext)
      } else if (level === 'warn') {
        systemLogger.warn(logMessage, logContext)
      } else {
        systemLogger.info(logMessage, logContext)
      }
    }
  })
  
  next()
}

// Error handler middleware
export const errorLoggerMiddleware = (
  error: Error,
  req: any,
  res: any,
  next: (err?: any) => void
) => {
  systemLogger.error(error.message, {
    service: 'backend',
    module: 'api',
    event: 'unhandled-error',
    stackTrace: error.stack,
    requestId: req.requestId,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent'],
    metadata: {
      method: req.method,
      path: req.path,
      query: req.query
    }
  })
  
  next(error)
}

export default systemLogger
