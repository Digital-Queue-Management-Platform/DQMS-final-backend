import WebSocket from 'ws'

interface VLCConfig {
  host: string
  port: number
  password?: string
}

interface BranchConfig {
  branchId: string
  speakerId: string
  centralServerWS: string
  vlcConfig: VLCConfig
}

class BranchSpeakerClient {
  private config: BranchConfig
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private heartbeatInterval: NodeJS.Timeout | null = null

  constructor(config: BranchConfig) {
    this.config = config
    this.connect()
  }

  private connect() {
    try {
      console.log(`🔌 Connecting to central server: ${this.config.centralServerWS}`)
      
      this.ws = new WebSocket(this.config.centralServerWS)

      this.ws.on('open', () => {
        console.log(`✅ Connected to central announcement server`)
        this.reconnectAttempts = 0
        this.register()
        this.startHeartbeat()
      })

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('close', () => {
        console.log(`❌ Connection to central server closed`)
        this.stopHeartbeat()
        this.attemptReconnect()
      })

      this.ws.on('error', (error) => {
        console.error(`🚨 WebSocket error:`, error.message)
      })

    } catch (error) {
      console.error(`🚨 Failed to connect:`, error)
      this.attemptReconnect()
    }
  }

  private register() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const registerMessage = {
        type: 'register',
        branchId: this.config.branchId,
        speakerId: this.config.speakerId,
        vlcConfig: this.config.vlcConfig
      }

      console.log(`📝 Registering branch ${this.config.branchId} with speaker ${this.config.speakerId}`)
      this.ws.send(JSON.stringify(registerMessage))
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'heartbeat',
          branchId: this.config.branchId,
          timestamp: new Date().toISOString()
        }))
      }
    }, 30000) // Send heartbeat every 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`🚨 Max reconnection attempts reached. Giving up.`)
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000) // Exponential backoff, max 30s

    console.log(`🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay/1000}s...`)
    
    setTimeout(() => {
      this.connect()
    }, delay)
  }

  private async handleMessage(messageStr: string) {
    try {
      const message = JSON.parse(messageStr)
      
      switch (message.type) {
        case 'registered':
          console.log(`✅ Successfully registered: ${message.message}`)
          break

        case 'announcement':
          await this.playAnnouncement(message)
          break

        case 'stop':
          await this.stopAnnouncement()
          break

        case 'error':
          console.error(`🚨 Server error: ${message.message}`)
          break

        default:
          console.log(`📨 Unknown message type: ${message.type}`)
      }
    } catch (error) {
      console.error(`🚨 Failed to handle message:`, error)
    }
  }

  private async playAnnouncement(announcement: any) {
    try {
      console.log(`🔊 Playing announcement for token ${announcement.tokenNumber || 'N/A'}`)
      console.log(`   Text: ${announcement.text}`)
      console.log(`   Language: ${announcement.language}`)
      console.log(`   Volume: ${announcement.volume}`)

      // Send to VLC HTTP interface
      if (announcement.audioUrl) {
        await this.playViaVLC(announcement.audioUrl, announcement.volume)
      } else {
        // Fallback to TTS if no audio URL provided
        await this.playViaTTS(announcement.text, announcement.language, announcement.volume)
      }

      console.log(`✅ Announcement completed successfully`)

    } catch (error) {
      console.error(`🚨 Failed to play announcement:`, error)
    }
  }

  private async playViaVLC(audioUrl: string, volume: number = 80) {
    try {
      const vlcBaseUrl = `http://${this.config.vlcConfig.host}:${this.config.vlcConfig.port}`
      
      // Set volume
      const volumeValue = Math.round((volume / 100) * 512) // VLC volume range is 0-512
      await this.sendVLCCommand(vlcBaseUrl, 'volume', { val: volumeValue })
      
      // Clear playlist first
      await this.sendVLCCommand(vlcBaseUrl, 'pl_empty')
      
      // Add and play audio
      await this.sendVLCCommand(vlcBaseUrl, 'in_play', { input: audioUrl })
      
      console.log(`🎵 Playing via VLC: ${audioUrl} at volume ${volume}%`)

    } catch (error) {
      console.error(`🚨 VLC playback failed:`, error)
      throw error
    }
  }

  private async playViaTTS(text: string, language: string, volume: number) {
    console.log(`🗣️  Fallback TTS: "${text}" in ${language} at ${volume}% volume`)
    // This would integrate with local TTS system
    // For now, just log the announcement
  }

  private async sendVLCCommand(baseUrl: string, command: string, params: Record<string, any> = {}) {
    try {
      const queryParams = new URLSearchParams({
        command,
        ...params
      })

      const url = `${baseUrl}/requests/status.json?${queryParams}`
      
      const headers: Record<string, string> = {}
      
      if (this.config.vlcConfig.password) {
        headers['Authorization'] = `Basic ${Buffer.from(`:${this.config.vlcConfig.password}`).toString('base64')}`
      }

      const response = await fetch(url, {
        method: 'GET',
        headers
      })

      if (!response.ok) {
        throw new Error(`VLC HTTP error: ${response.status} ${response.statusText}`)
      }

      return await response.json()

    } catch (error) {
      console.error(`🚨 VLC command '${command}' failed:`, error)
      throw error
    }
  }

  private async stopAnnouncement() {
    try {
      console.log(`⏹️  Stopping current announcement`)
      
      const vlcBaseUrl = `http://${this.config.vlcConfig.host}:${this.config.vlcConfig.port}`
      await this.sendVLCCommand(vlcBaseUrl, 'pl_stop')
      
      console.log(`✅ Announcement stopped`)

    } catch (error) {
      console.error(`🚨 Failed to stop announcement:`, error)
    }
  }

  public async testVLCConnection(): Promise<boolean> {
    try {
      console.log(`🧪 Testing VLC connection...`)
      
      const vlcBaseUrl = `http://${this.config.vlcConfig.host}:${this.config.vlcConfig.port}`
      const result = await this.sendVLCCommand(vlcBaseUrl, 'status')
      
      console.log(`✅ VLC connection successful:`, (result as any)?.state || 'Connected')
      return true

    } catch (error) {
      console.error(`🚨 VLC connection test failed:`, error)
      return false
    }
  }

  public disconnect() {
    console.log(`🔌 Disconnecting from central server...`)
    
    this.stopHeartbeat()
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// Example usage and testing
async function main() {
  // Configuration from environment variables or config file
  const config: BranchConfig = {
    branchId: process.env.BRANCH_ID || 'branch-001',
    speakerId: process.env.SPEAKER_ID || 'speaker-001',
    centralServerWS: process.env.CENTRAL_SERVER_WS || 'ws://localhost:8080',
    vlcConfig: {
      host: process.env.VLC_HOST || 'localhost',
      port: parseInt(process.env.VLC_PORT || '8081'),
      password: process.env.VLC_PASSWORD || undefined
    }
  }

  console.log(`🚀 Starting Branch Speaker Client`)
  console.log(`   Branch ID: ${config.branchId}`)
  console.log(`   Speaker ID: ${config.speakerId}`)
  console.log(`   Central Server: ${config.centralServerWS}`)
  console.log(`   VLC: http://${config.vlcConfig.host}:${config.vlcConfig.port}`)

  const client = new BranchSpeakerClient(config)

  // Test VLC connection
  setTimeout(async () => {
    const vlcWorking = await client.testVLCConnection()
    if (!vlcWorking) {
      console.log(`⚠️  VLC is not responding. Make sure VLC is running with HTTP interface enabled:`)
      console.log(`   vlc --intf http --http-password yourpassword --http-port 8081`)
    }
  }, 2000)

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n👋 Shutting down gracefully...`)
    client.disconnect()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log(`\n👋 Shutting down gracefully...`)
    client.disconnect()
    process.exit(0)
  })
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error(`🚨 Fatal error:`, error)
    process.exit(1)
  })
}

export { BranchSpeakerClient, type BranchConfig, type VLCConfig }