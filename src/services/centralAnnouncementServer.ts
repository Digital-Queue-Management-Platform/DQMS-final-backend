import express from 'express'
import cors from 'cors'
import { WebSocket, WebSocketServer } from 'ws'
import { createServer } from 'http'

const app = express()
const server = createServer(app)
const PORT = process.env.CENTRAL_SPEAKER_PORT || 3001
const WS_PORT = parseInt(process.env.CENTRAL_SPEAKER_WS_PORT || '8080')

app.use(cors())
app.use(express.json())

// WebSocket server for real-time announcements
const wss = new WebSocketServer({ port: WS_PORT })

interface AnnouncementRequest {
  branchId: string
  counterId?: string
  text: string
  language: 'en' | 'si' | 'ta'
  volume: number
  priority: 'normal' | 'urgent'
  tokenNumber?: number
}

interface VLCConfig {
  host: string
  port: number
  password?: string
}

// Store connected branches and their speaker configurations
const connectedBranches = new Map<string, {
  websockets: WebSocket[]
  vlcConfig?: VLCConfig
  lastActivity: Date
}>()

// VLC HTTP interface integration
class VLCController {
  private config: VLCConfig

  constructor(config: VLCConfig) {
    this.config = config
  }

  private async sendVLCCommand(command: string, params: Record<string, any> = {}): Promise<any> {
    try {
      const baseUrl = `http://${this.config.host}:${this.config.port}`
      const queryParams = new URLSearchParams({
        command,
        ...params
      })

      const url = `${baseUrl}/requests/status.json?${queryParams}`
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...(this.config.password && {
            'Authorization': `Basic ${Buffer.from(`:${this.config.password}`).toString('base64')}`
          })
        }
      })

      if (!response.ok) {
        throw new Error(`VLC HTTP error: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error('VLC command error:', error)
      throw error
    }
  }

  async playAnnouncement(audioUrl: string, volume: number = 80): Promise<void> {
    try {
      // Set volume
      await this.sendVLCCommand('volume', { val: Math.round((volume / 100) * 512) })
      
      // Add audio to playlist and play
      await this.sendVLCCommand('in_play', { input: audioUrl })
      
      console.log(`Playing announcement via VLC: ${audioUrl} at volume ${volume}`)
    } catch (error) {
      console.error('Failed to play announcement via VLC:', error)
      throw error
    }
  }

  async stopPlayback(): Promise<void> {
    try {
      await this.sendVLCCommand('pl_stop')
      console.log('Stopped VLC playback')
    } catch (error) {
      console.error('Failed to stop VLC playback:', error)
      throw error
    }
  }

  async getStatus(): Promise<any> {
    try {
      return await this.sendVLCCommand('status')
    } catch (error) {
      console.error('Failed to get VLC status:', error)
      throw error
    }
  }

  async clearPlaylist(): Promise<void> {
    try {
      await this.sendVLCCommand('pl_empty')
      console.log('Cleared VLC playlist')
    } catch (error) {
      console.error('Failed to clear VLC playlist:', error)
      throw error
    }
  }
}

// Text-to-Speech Service (simplified without Google TTS dependency)
class TTSService {
  constructor() {
    // Simplified TTS service without external dependencies
  }

  async generateSpeech(text: string, language: 'en' | 'si' | 'ta'): Promise<string> {
    try {
      return await this.generateFallbackTTS(text, language)
    } catch (error) {
      console.error('TTS generation failed:', error)
      throw error
    }
  }

  private async generateFallbackTTS(text: string, language: 'en' | 'si' | 'ta'): Promise<string> {
    // For demonstration, we'll return a placeholder URL
    // In production, integrate with your preferred TTS service
    const encodedText = encodeURIComponent(text)
    const timestamp = Date.now()
    
    // You can replace this with any TTS service API or local TTS
    return `http://localhost:${PORT}/api/tts/generate?text=${encodedText}&lang=${language}&id=${timestamp}`
  }
}

const ttsService = new TTSService()

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.socket.remoteAddress)
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString())
      
      if (data.type === 'register') {
        await handleBranchRegistration(ws, data)
      } else if (data.type === 'vlc_config') {
        await handleVLCConfiguration(data)
      } else if (data.type === 'heartbeat') {
        await handleHeartbeat(data.branchId)
      }
    } catch (error) {
      console.error('WebSocket message error:', error)
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }))
    }
  })
  
  ws.on('close', () => {
    handleDisconnection(ws)
  })

  ws.on('error', (error) => {
    console.error('WebSocket error:', error)
  })
})

async function handleBranchRegistration(ws: WebSocket, data: any) {
  const { branchId, speakerId, vlcConfig } = data
  
  if (!connectedBranches.has(branchId)) {
    connectedBranches.set(branchId, {
      websockets: [],
      lastActivity: new Date()
    })
  }
  
  const branch = connectedBranches.get(branchId)!
  branch.websockets.push(ws)
  
  if (vlcConfig) {
    branch.vlcConfig = vlcConfig
  }
  
  ws.send(JSON.stringify({
    type: 'registered',
    branchId,
    speakerId,
    message: 'Successfully registered with central server'
  }))
  
  console.log(`Branch ${branchId} registered with speaker ${speakerId}`)
}

async function handleVLCConfiguration(data: any) {
  const { branchId, vlcConfig } = data
  
  if (connectedBranches.has(branchId)) {
    const branch = connectedBranches.get(branchId)!
    branch.vlcConfig = vlcConfig
    console.log(`VLC configuration updated for branch ${branchId}:`, vlcConfig)
  }
}

async function handleHeartbeat(branchId: string) {
  if (connectedBranches.has(branchId)) {
    const branch = connectedBranches.get(branchId)!
    branch.lastActivity = new Date()
  }
}

function handleDisconnection(ws: WebSocket) {
  for (const [branchId, branch] of connectedBranches.entries()) {
    const index = branch.websockets.indexOf(ws)
    if (index > -1) {
      branch.websockets.splice(index, 1)
      console.log(`WebSocket disconnected from branch ${branchId}`)
      
      if (branch.websockets.length === 0) {
        console.log(`No more connections for branch ${branchId}`)
      }
      break
    }
  }
}

// REST API Endpoints

// Send announcement to specific branch
app.post('/api/announce', async (req, res) => {
  try {
    const announcement: AnnouncementRequest = req.body
    
    if (!announcement.branchId || !announcement.text) {
      return res.status(400).json({ error: 'Missing required fields: branchId and text' })
    }
    
    const branch = connectedBranches.get(announcement.branchId)
    
    if (!branch) {
      return res.status(404).json({ 
        error: 'Branch not found or not connected',
        branchId: announcement.branchId 
      })
    }
    
    // Generate TTS audio
    let audioUrl: string
    try {
      audioUrl = await ttsService.generateSpeech(announcement.text, announcement.language)
    } catch (ttsError) {
      console.error('TTS generation failed:', ttsError)
      return res.status(500).json({ error: 'Failed to generate speech audio' })
    }
    
    let successCount = 0
    const errors: string[] = []
    
    // Send to VLC if configured
    if (branch.vlcConfig) {
      try {
        const vlcController = new VLCController(branch.vlcConfig)
        await vlcController.playAnnouncement(audioUrl, announcement.volume)
        successCount++
      } catch (vlcError) {
        console.error('VLC playback failed:', vlcError)
        errors.push(`VLC playback failed: ${vlcError}`)
      }
    }
    
    // Send to WebSocket clients
    const message = JSON.stringify({
      type: 'announcement',
      ...announcement,
      audioUrl,
      timestamp: new Date().toISOString()
    })
    
    branch.websockets.forEach(ws => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message)
          successCount++
        }
      } catch (wsError) {
        console.error('WebSocket send failed:', wsError)
        errors.push(`WebSocket send failed: ${wsError}`)
      }
    })
    
    branch.lastActivity = new Date()
    
    res.json({
      success: true,
      message: `Announcement sent successfully`,
      branchId: announcement.branchId,
      successCount,
      errors: errors.length > 0 ? errors : undefined,
      audioUrl
    })
    
  } catch (error) {
    console.error('Announcement error:', error)
    res.status(500).json({ error: 'Failed to process announcement' })
  }
})

// Stop announcement for a branch
app.post('/api/stop', async (req, res) => {
  try {
    const { branchId } = req.body
    
    if (!branchId) {
      return res.status(400).json({ error: 'Missing branchId' })
    }
    
    const branch = connectedBranches.get(branchId)
    
    if (!branch) {
      return res.status(404).json({ 
        error: 'Branch not found',
        branchId 
      })
    }
    
    // Stop VLC playback
    if (branch.vlcConfig) {
      try {
        const vlcController = new VLCController(branch.vlcConfig)
        await vlcController.stopPlayback()
      } catch (vlcError) {
        console.error('VLC stop failed:', vlcError)
      }
    }
    
    // Send stop command to WebSocket clients
    const stopMessage = JSON.stringify({
      type: 'stop',
      branchId,
      timestamp: new Date().toISOString()
    })
    
    branch.websockets.forEach(ws => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(stopMessage)
        }
      } catch (error) {
        console.error('WebSocket stop send failed:', error)
      }
    })
    
    res.json({
      success: true,
      message: 'Stop command sent',
      branchId
    })
    
  } catch (error) {
    console.error('Stop announcement error:', error)
    res.status(500).json({ error: 'Failed to stop announcement' })
  }
})

// Health check and status
app.get('/api/health', async (req, res) => {
  try {
    const branchStatuses = []
    
    for (const [branchId, branch] of connectedBranches.entries()) {
      let vlcStatus = null
      
      if (branch.vlcConfig) {
        try {
          const vlcController = new VLCController(branch.vlcConfig)
          vlcStatus = await vlcController.getStatus()
        } catch (error) {
          vlcStatus = { error: 'VLC not responding' }
        }
      }
      
      branchStatuses.push({
        branchId,
        websocketConnections: branch.websockets.length,
        hasVLC: !!branch.vlcConfig,
        vlcStatus,
        lastActivity: branch.lastActivity,
        isActive: Date.now() - branch.lastActivity.getTime() < 300000 // 5 minutes
      })
    }
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      totalBranches: connectedBranches.size,
      branches: branchStatuses,
      server: {
        port: PORT,
        wsPort: WS_PORT,
        uptime: process.uptime()
      }
    })
    
  } catch (error) {
    console.error('Health check error:', error)
    res.status(500).json({ 
      status: 'error', 
      error: 'Health check failed' 
    })
  }
})

// TTS generation endpoint (fallback)
app.get('/api/tts/generate', async (req, res) => {
  try {
    const { text, lang, id } = req.query
    
    if (!text) {
      return res.status(400).json({ error: 'Missing text parameter' })
    }
    
    // For demonstration, return a simple response
    // In production, you would generate actual TTS audio here
    res.json({
      success: true,
      message: 'TTS generation placeholder',
      text,
      language: lang,
      id,
      audioUrl: `http://localhost:${PORT}/api/tts/audio/${id}`
    })
    
  } catch (error) {
    console.error('TTS generation error:', error)
    res.status(500).json({ error: 'TTS generation failed' })
  }
})

// Get audio file (placeholder)
app.get('/api/tts/audio/:id', (req, res) => {
  // Return a placeholder audio response
  res.status(404).json({ error: 'Audio file not found' })
})

// Branch management endpoints
app.get('/api/branches', (req, res) => {
  try {
    const branches = Array.from(connectedBranches.entries()).map(([branchId, branch]) => ({
      branchId,
      connections: branch.websockets.length,
      hasVLC: !!branch.vlcConfig,
      lastActivity: branch.lastActivity,
      isActive: Date.now() - branch.lastActivity.getTime() < 300000
    }))
    
    res.json({
      success: true,
      branches
    })
  } catch (error) {
    console.error('Branch list error:', error)
    res.status(500).json({ error: 'Failed to get branch list' })
  }
})

// Configure VLC for a branch
app.post('/api/branches/:branchId/vlc', (req, res) => {
  try {
    const { branchId } = req.params
    const vlcConfig: VLCConfig = req.body
    
    if (!vlcConfig.host || !vlcConfig.port) {
      return res.status(400).json({ error: 'Missing VLC host or port' })
    }
    
    const branch = connectedBranches.get(branchId)
    
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' })
    }
    
    branch.vlcConfig = vlcConfig
    
    res.json({
      success: true,
      message: 'VLC configuration updated',
      branchId,
      vlcConfig
    })
    
  } catch (error) {
    console.error('VLC configuration error:', error)
    res.status(500).json({ error: 'Failed to configure VLC' })
  }
})

// Start the server
server.listen(PORT, () => {
  console.log(`🎙️  Central Announcement Server running on port ${PORT}`)
  console.log(`📡 WebSocket server running on port ${WS_PORT}`)
  console.log(`🔊 VLC HTTP integration enabled`)
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down Central Announcement Server...')
  server.close(() => {
    wss.close(() => {
      process.exit(0)
    })
  })
})

export { app, server, wss }