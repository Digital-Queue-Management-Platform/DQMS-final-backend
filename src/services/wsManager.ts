/**
 * WebSocket Manager - Room-based subscription system for real-time updates
 * Implements WhatsApp Web-style instant communication
 */

import { WebSocket } from "ws"

interface WSClient {
  ws: WebSocket
  rooms: Set<string>
  deviceId?: string
  sessionId?: string
  managerId?: string
  outletId?: string
  connectedAt: Date
  lastHeartbeat: Date
}

interface BroadcastMessage {
  type: string
  data: any
  room?: string
  targetDeviceId?: string
  targetManagerId?: string
}

class WebSocketManager {
  private clients: Map<WebSocket, WSClient> = new Map()
  private rooms: Map<string, Set<WebSocket>> = new Map()
  private deviceConnections: Map<string, WebSocket> = new Map()
  private sessionConnections: Map<string, WebSocket> = new Map()
  private managerConnections: Map<string, WebSocket> = new Map()
  private heartbeatInterval: NodeJS.Timeout | null = null

  constructor() {
    // Start heartbeat checker (every 30 seconds)
    this.startHeartbeatChecker()
  }

  /**
   * Register a new WebSocket connection
   */
  registerClient(ws: WebSocket, metadata?: {
    deviceId?: string
    sessionId?: string
    managerId?: string
    outletId?: string
  }): void {
    const client: WSClient = {
      ws,
      rooms: new Set(),
      deviceId: metadata?.deviceId,
      sessionId: metadata?.sessionId,
      managerId: metadata?.managerId,
      outletId: metadata?.outletId,
      connectedAt: new Date(),
      lastHeartbeat: new Date()
    }

    this.clients.set(ws, client)

    // Index by deviceId, sessionId, managerId for quick lookup
    if (metadata?.deviceId) {
      this.deviceConnections.set(metadata.deviceId, ws)
    }
    if (metadata?.sessionId) {
      this.sessionConnections.set(metadata.sessionId, ws)
    }
    if (metadata?.managerId) {
      this.managerConnections.set(metadata.managerId, ws)
    }

    console.log(`WebSocket client registered:`, {
      deviceId: metadata?.deviceId,
      sessionId: metadata?.sessionId,
      managerId: metadata?.managerId,
      totalClients: this.clients.size
    })
  }

  /**
   * Unregister a WebSocket connection
   */
  unregisterClient(ws: WebSocket): void {
    const client = this.clients.get(ws)
    if (!client) return

    // Remove from all rooms
    client.rooms.forEach(room => {
      this.leaveRoom(ws, room)
    })

    // Remove from indexes
    if (client.deviceId) {
      this.deviceConnections.delete(client.deviceId)
    }
    if (client.sessionId) {
      this.sessionConnections.delete(client.sessionId)
    }
    if (client.managerId) {
      this.managerConnections.delete(client.managerId)
    }

    this.clients.delete(ws)

    console.log(`WebSocket client unregistered:`, {
      deviceId: client.deviceId,
      sessionId: client.sessionId,
      managerId: client.managerId,
      totalClients: this.clients.size
    })
  }

  /**
   * Subscribe a client to a room
   */
  joinRoom(ws: WebSocket, roomName: string): void {
    const client = this.clients.get(ws)
    if (!client) return

    client.rooms.add(roomName)

    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set())
    }
    this.rooms.get(roomName)!.add(ws)

    console.log(`Client joined room: ${roomName}`)
  }

  /**
   * Unsubscribe a client from a room
   */
  leaveRoom(ws: WebSocket, roomName: string): void {
    const client = this.clients.get(ws)
    if (!client) return

    client.rooms.delete(roomName)

    const room = this.rooms.get(roomName)
    if (room) {
      room.delete(ws)
      if (room.size === 0) {
        this.rooms.delete(roomName)
        console.log(`Room deleted (empty): ${roomName}`)
      }
    }

    console.log(`Client left room: ${roomName}`)
  }

  /**
   * Send message to a specific client
   */
  sendToClient(ws: WebSocket, message: any): boolean {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message))
        return true
      } catch (error: any) {
        console.error(`❌ Failed to send message to client:`, error.message)
        return false
      }
    }
    return false
  }

  /**
   * Send message to device by deviceId
   */
  sendToDevice(deviceId: string, message: any): boolean {
    const ws = this.deviceConnections.get(deviceId)
    if (ws) {
      return this.sendToClient(ws, message)
    }
    console.warn(`⚠️  Device not connected: ${deviceId}`)
    return false
  }

  /**
   * Send message to session by sessionId
   */
  sendToSession(sessionId: string, message: any): boolean {
    const ws = this.sessionConnections.get(sessionId)
    if (ws) {
      return this.sendToClient(ws, message)
    }
    console.warn(`⚠️  Session not connected: ${sessionId}`)
    return false
  }

  /**
   * Send message to manager by managerId
   */
  sendToManager(managerId: string, message: any): boolean {
    const ws = this.managerConnections.get(managerId)
    if (ws) {
      return this.sendToClient(ws, message)
    }
    console.warn(`⚠️  Manager not connected: ${managerId}`)
    return false
  }

  /**
   * Broadcast message to all clients in a room
   */
  broadcastToRoom(roomName: string, message: any, excludeWs?: WebSocket): void {
    const room = this.rooms.get(roomName)
    if (!room) {
      console.warn(`⚠️  Room not found: ${roomName}`)
      return
    }

    let successCount = 0
    let failCount = 0

    room.forEach(ws => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message))
          successCount++
        } catch (error: any) {
          console.error(`❌ Failed to broadcast to client:`, error.message)
          failCount++
        }
      }
    })

    console.log(`Broadcast to room ${roomName}: ${successCount} sent, ${failCount} failed`)
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcastToAll(message: any, excludeWs?: WebSocket): void {
    let successCount = 0
    let failCount = 0

    this.clients.forEach((client, ws) => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message))
          successCount++
        } catch (error: any) {
          console.error(`❌ Failed to broadcast to client:`, error.message)
          failCount++
        }
      }
    })

    console.log(`Broadcast to all: ${successCount} sent, ${failCount} failed`)
  }

  /**
   * Smart broadcast - routes message based on target
   */
  broadcast(message: BroadcastMessage): void {
    if (message.targetDeviceId) {
      this.sendToDevice(message.targetDeviceId, message)
    } else if (message.targetManagerId) {
      this.sendToManager(message.targetManagerId, message)
    } else if (message.room) {
      this.broadcastToRoom(message.room, message)
    } else {
      this.broadcastToAll(message)
    }
  }

  /**
   * Update client heartbeat timestamp
   */
  updateHeartbeat(ws: WebSocket): void {
    const client = this.clients.get(ws)
    if (client) {
      client.lastHeartbeat = new Date()
    }
  }

  /**
   * Get client metadata
   */
  getClient(ws: WebSocket): WSClient | undefined {
    return this.clients.get(ws)
  }

  /**
   * Check if device is connected
   */
  isDeviceConnected(deviceId: string): boolean {
    const ws = this.deviceConnections.get(deviceId)
    return ws !== undefined && ws.readyState === WebSocket.OPEN
  }

  /**
   * Check if session is connected
   */
  isSessionConnected(sessionId: string): boolean {
    const ws = this.sessionConnections.get(sessionId)
    return ws !== undefined && ws.readyState === WebSocket.OPEN
  }

  /**
   * Check if manager is connected
   */
  isManagerConnected(managerId: string): boolean {
    const ws = this.managerConnections.get(managerId)
    return ws !== undefined && ws.readyState === WebSocket.OPEN
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    totalClients: number
    totalRooms: number
    devices: number
    sessions: number
    managers: number
  } {
    return {
      totalClients: this.clients.size,
      totalRooms: this.rooms.size,
      devices: this.deviceConnections.size,
      sessions: this.sessionConnections.size,
      managers: this.managerConnections.size
    }
  }

  /**
   * Start smart heartbeat checker - graceful connection management
   */
  private startHeartbeatChecker(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now()
      const staleTimeout = 600000 // 10 minutes - extended timeout
      const pingTimeout = 180000  // 3 minutes - send ping first

      this.clients.forEach((client, ws) => {
        const timeSinceHeartbeat = now - client.lastHeartbeat.getTime()
        
        // Send ping to check if client is still alive (at 3 minutes)
        if (timeSinceHeartbeat > pingTimeout && timeSinceHeartbeat < staleTimeout) {
          if (ws.readyState === 1) { // WebSocket.OPEN
            try {
              ws.ping() // Send WebSocket ping frame
              console.log(`Ping sent to client (${Math.round(timeSinceHeartbeat / 1000)}s since last heartbeat)`)
            } catch (error) {
              console.log(`⚠️  Failed to ping client, marking for closure`)
              ws.close(1000, 'Ping failed')
              this.unregisterClient(ws)
            }
          }
        }
        
        // Only close if no response for 10 minutes
        else if (timeSinceHeartbeat > staleTimeout) {
          console.log(`⚠️  Closing stale connection after extended timeout:`, {
            deviceId: client.deviceId,
            sessionId: client.sessionId,
            timeSinceHeartbeat: Math.round(timeSinceHeartbeat / 1000) + 's'
          })
          
          ws.close(1000, 'Extended timeout - no heartbeat')
          this.unregisterClient(ws)
        }
      })
    }, 60000) // Check every 60 seconds (less aggressive)
  }

  /**
   * Cleanup - stop heartbeat checker
   */
  cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }
}

// Singleton instance
export const wsManager = new WebSocketManager()

// Helper functions for common room names
export const QR_SESSION_ROOM = (sessionId: string) => `qr:session:${sessionId}`
export const OUTLET_DEVICES_ROOM = (outletId: string) => `outlet:${outletId}:devices`
export const MANAGER_DEVICES_ROOM = (managerId: string) => `manager:${managerId}:devices`
