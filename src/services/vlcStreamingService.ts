import { exec, spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Production configuration
const PRODUCTION_CONFIG = {
  MAX_SESSIONS: 10,
  MAX_AUDIO_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_TEMP_DIRECTORY_SIZE: 100 * 1024 * 1024, // 100MB
  AUDIO_FILE_RETENTION_MS: 5 * 60 * 1000, // 5 minutes
  CLEANUP_INTERVAL_MS: 2 * 60 * 1000, // 2 minutes
  VLC_TIMEOUT_MS: 30000, // 30 seconds
  SESSION_TIMEOUT_MS: 60000, // 1 minute
}

interface VLCStreamConfig {
  protocol: 'http' | 'udp' | 'rtsp'
  port: number
  ip?: string
  path?: string
  multicast?: boolean
}

interface StreamingSession {
  id: string
  process: ChildProcess | null
  config: VLCStreamConfig
  audioFile: string
  startTime: Date
  status: 'starting' | 'active' | 'stopping' | 'stopped'
  lastActivity: Date
  errorCount: number
}

interface ServiceMetrics {
  totalSessions: number
  activeSessions: number
  failedSessions: number
  audioFilesGenerated: number
  diskUsage: number
  vlcAvailable: boolean
  lastHealthCheck: Date
}

class VLCStreamingService {
  private sessions: Map<string, StreamingSession> = new Map()
  private audioDirectory: string
  private cleanupInterval: NodeJS.Timeout | null = null
  private metrics: ServiceMetrics
  private vlcAvailable: boolean | null = null

  constructor() {
    this.audioDirectory = join(process.cwd(), 'temp', 'audio')
    this.metrics = {
      totalSessions: 0,
      activeSessions: 0,
      failedSessions: 0,
      audioFilesGenerated: 0,
      diskUsage: 0,
      vlcAvailable: false,
      lastHealthCheck: new Date()
    }
    
    this.initialize()
  }

  private async initialize() {
    try {
      await this.ensureAudioDirectory()
      await this.checkVLCAvailability()
      this.startCleanupInterval()
      this.log('info', 'VLC Streaming Service initialized successfully')
    } catch (error) {
      this.log('error', 'Failed to initialize VLC Streaming Service', error)
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string, error?: any) {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] [VLC-${level.toUpperCase()}] ${message}`
    
    if (level === 'error') {
      console.error(logMessage, error)
    } else if (level === 'warn') {
      console.warn(logMessage)
    } else {
      console.log(logMessage)
    }
  }

  private async checkVLCAvailability(): Promise<boolean> {
    try {
      await execAsync('vlc --version')
      this.vlcAvailable = true
      this.metrics.vlcAvailable = true
      this.log('info', 'VLC Media Player is available')
      return true
    } catch (error) {
      this.vlcAvailable = false
      this.metrics.vlcAvailable = false
      this.log('warn', 'VLC Media Player not found. Audio streaming will be limited to browser synthesis.')
      return false
    }
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(async () => {
      await this.performMaintenance()
    }, PRODUCTION_CONFIG.CLEANUP_INTERVAL_MS)
  }

  private async performMaintenance() {
    try {
      await this.cleanupExpiredSessions()
      await this.cleanupOldAudioFiles()
      await this.updateDiskUsage()
      this.metrics.lastHealthCheck = new Date()
    } catch (error) {
      this.log('error', 'Maintenance cycle failed', error)
    }
  }

  private async cleanupExpiredSessions() {
    const now = Date.now()
    const expiredSessions: string[] = []

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > PRODUCTION_CONFIG.SESSION_TIMEOUT_MS) {
        expiredSessions.push(sessionId)
      }
    }

    for (const sessionId of expiredSessions) {
      await this.stopStream(sessionId)
      this.log('info', `Cleaned up expired session: ${sessionId}`)
    }
  }

  private async cleanupOldAudioFiles() {
    try {
      const files = await fs.readdir(this.audioDirectory)
      const now = Date.now()

      for (const file of files) {
        const filePath = join(this.audioDirectory, file)
        const stats = await fs.stat(filePath)
        
        if (now - stats.birthtime.getTime() > PRODUCTION_CONFIG.AUDIO_FILE_RETENTION_MS) {
          await fs.unlink(filePath)
          this.log('info', `Cleaned up old audio file: ${file}`)
        }
      }
    } catch (error) {
      this.log('error', 'Failed to cleanup old audio files', error)
    }
  }

  private async updateDiskUsage() {
    try {
      const files = await fs.readdir(this.audioDirectory)
      let totalSize = 0

      for (const file of files) {
        const filePath = join(this.audioDirectory, file)
        const stats = await fs.stat(filePath)
        totalSize += stats.size
      }

      this.metrics.diskUsage = totalSize

      if (totalSize > PRODUCTION_CONFIG.MAX_TEMP_DIRECTORY_SIZE) {
        this.log('warn', `Temp directory size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds limit`)
        await this.forceCleanupLargestFiles()
      }
    } catch (error) {
      this.log('error', 'Failed to update disk usage', error)
    }
  }

  private async forceCleanupLargestFiles() {
    try {
      const files = await fs.readdir(this.audioDirectory)
      const fileStats = await Promise.all(
        files.map(async (file) => {
          const filePath = join(this.audioDirectory, file)
          const stats = await fs.stat(filePath)
          return { file, path: filePath, size: stats.size, time: stats.birthtime }
        })
      )

      // Sort by size (largest first) and delete until under limit
      fileStats.sort((a, b) => b.size - a.size)
      
      let deletedSize = 0
      for (const fileInfo of fileStats) {
        if (this.metrics.diskUsage - deletedSize < PRODUCTION_CONFIG.MAX_TEMP_DIRECTORY_SIZE * 0.8) {
          break
        }
        
        await fs.unlink(fileInfo.path)
        deletedSize += fileInfo.size
        this.log('info', `Force cleaned up large file: ${fileInfo.file} (${Math.round(fileInfo.size / 1024)}KB)`)
      }
    } catch (error) {
      this.log('error', 'Failed to force cleanup large files', error)
    }
  }

  private async ensureAudioDirectory() {
    try {
      await fs.mkdir(this.audioDirectory, { recursive: true })
    } catch (error) {
      console.error('Failed to create audio directory:', error)
    }
  }

  /**
   * Generate audio file from text using speech synthesis
   */
  async generateAudioFile(text: string, language: string = 'en'): Promise<string> {
    const filename = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`
    const filePath = join(this.audioDirectory, filename)

    try {
      // For Windows, use PowerShell's built-in speech synthesis
      if (process.platform === 'win32') {
        const psScript = `
          Add-Type -AssemblyName System.Speech
          $speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
          
          # Set voice based on language
          $voices = $speech.GetInstalledVoices()
          switch ("${language}") {
            "si" { 
              $sinhalaVoice = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like "*si*" -or $_.VoiceInfo.Name -like "*Sinhala*" }
              if ($sinhalaVoice) { $speech.SelectVoice($sinhalaVoice[0].VoiceInfo.Name) }
            }
            "ta" { 
              $tamilVoice = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like "*ta*" -or $_.VoiceInfo.Name -like "*Tamil*" }
              if ($tamilVoice) { $speech.SelectVoice($tamilVoice[0].VoiceInfo.Name) }
            }
            default { 
              $englishVoice = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like "en-*" }
              if ($englishVoice) { $speech.SelectVoice($englishVoice[0].VoiceInfo.Name) }
            }
          }
          
          $speech.SetOutputToWaveFile("${filePath.replace(/\\/g, '\\\\')}")
          $speech.Speak("${text.replace(/"/g, '""')}")
          $speech.Dispose()
        `

        await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`)
      } else {
        // For Linux/macOS, use espeak or similar
        await execAsync(`espeak "${text}" -w "${filePath}" -s 150`)
      }

      return filePath
    } catch (error) {
      console.error('Failed to generate audio file:', error)
      throw new Error('Audio generation failed')
    }
  }

  /**
   * Start VLC streaming session
   */
  async startStream(sessionId: string, text: string, language: string, config: VLCStreamConfig): Promise<boolean> {
    try {
      // Production validations
      if (!this.validateInput(sessionId, text, language, config)) {
        return false
      }

      if (this.sessions.size >= PRODUCTION_CONFIG.MAX_SESSIONS) {
        this.log('warn', `Maximum sessions (${PRODUCTION_CONFIG.MAX_SESSIONS}) reached. Cannot start new session.`)
        return false
      }

      if (!this.vlcAvailable) {
        this.log('warn', 'VLC not available. Cannot start streaming session.')
        return false
      }

      // Clean up any existing session
      await this.stopStream(sessionId)

      this.log('info', `Starting VLC stream session: ${sessionId}`)
      
      // Generate audio file
      const audioFile = await this.generateAudioFile(text, language)
      
      // Validate audio file size
      const stats = await fs.stat(audioFile)
      if (stats.size > PRODUCTION_CONFIG.MAX_AUDIO_FILE_SIZE) {
        await fs.unlink(audioFile)
        this.log('error', `Audio file too large: ${Math.round(stats.size / 1024 / 1024)}MB`)
        return false
      }

      // Create session
      const session: StreamingSession = {
        id: sessionId,
        process: null,
        config,
        audioFile,
        startTime: new Date(),
        status: 'starting',
        lastActivity: new Date(),
        errorCount: 0
      }
      
      this.sessions.set(sessionId, session)
      this.metrics.totalSessions++
      this.metrics.activeSessions++
      this.metrics.audioFilesGenerated++

      // Build VLC command based on protocol
      const vlcCommand = this.buildVLCCommand(audioFile, config)
      
      this.log('info', `VLC Command: ${vlcCommand}`)

      // Start VLC process
      const vlcProcess = spawn('vlc', vlcCommand.split(' '), {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      })

      session.process = vlcProcess
      session.status = 'active'

      // Handle process events
      vlcProcess.on('error', (error) => {
        this.log('error', `VLC process error for session ${sessionId}`, error)
        session.status = 'stopped'
        session.errorCount++
        this.metrics.failedSessions++
      })

      vlcProcess.on('exit', (code) => {
        this.log('info', `VLC process exited for session ${sessionId} with code ${code}`)
        session.status = 'stopped'
        this.cleanupSession(sessionId)
      })

      // Set timeout to automatically stop stream
      setTimeout(() => {
        if (this.sessions.has(sessionId)) {
          this.stopStream(sessionId)
        }
      }, PRODUCTION_CONFIG.VLC_TIMEOUT_MS)

      return true
    } catch (error) {
      this.log('error', `Failed to start VLC stream for session ${sessionId}`, error)
      this.metrics.failedSessions++
      return false
    }
  }

  private validateInput(sessionId: string, text: string, language: string, config: VLCStreamConfig): boolean {
    // Validate session ID
    if (!sessionId || sessionId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      this.log('error', 'Invalid session ID')
      return false
    }

    // Validate text
    if (!text || text.length > 1000) {
      this.log('error', 'Invalid text: empty or too long')
      return false
    }

    // Validate language
    if (!['en', 'si', 'ta'].includes(language)) {
      this.log('error', `Invalid language: ${language}`)
      return false
    }

    // Validate config
    if (!config.protocol || !['http', 'udp', 'rtsp'].includes(config.protocol)) {
      this.log('error', `Invalid protocol: ${config.protocol}`)
      return false
    }

    if (!config.port || config.port < 1 || config.port > 65535) {
      this.log('error', `Invalid port: ${config.port}`)
      return false
    }

    // Validate IP if provided
    if (config.ip && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(config.ip)) {
      this.log('error', `Invalid IP address: ${config.ip}`)
      return false
    }

    return true
  }

  /**
   * Stop VLC streaming session
   */
  async stopStream(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    try {
      session.status = 'stopping'
      session.lastActivity = new Date()

      if (session.process) {
        session.process.kill('SIGTERM')
        
        // Force kill after 5 seconds if not terminated
        setTimeout(() => {
          if (session.process && !session.process.killed) {
            session.process.kill('SIGKILL')
            this.log('warn', `Force killed VLC process for session ${sessionId}`)
          }
        }, 5000)
      }

      await this.cleanupSession(sessionId)
      this.log('info', `Stopped VLC stream session: ${sessionId}`)
      return true
    } catch (error) {
      this.log('error', `Failed to stop VLC stream for session ${sessionId}`, error)
      return false
    }
  }

  /**
   * Get streaming session status
   */
  getSessionStatus(sessionId: string): string | null {
    const session = this.sessions.get(sessionId)
    return session ? session.status : null
  }

  /**
   * Build VLC command line arguments
   */
  private buildVLCCommand(audioFile: string, config: VLCStreamConfig): string {
    const baseArgs = [
      '--intf', 'dummy',
      '--extraintf', 'http',
      '--play-and-exit',
      audioFile
    ]

    switch (config.protocol) {
      case 'http':
        return [
          ...baseArgs,
          '--sout', `#http{mux=mp3,dst=:${config.port}${config.path || '/'}}`
        ].join(' ')

      case 'udp':
        const destination = config.multicast 
          ? '239.255.12.42'  // Default multicast address
          : (config.ip || '127.0.0.1')
        return [
          ...baseArgs,
          '--sout', `#udp{dst=${destination}:${config.port}}`
        ].join(' ')

      case 'rtsp':
        return [
          ...baseArgs,
          '--sout', `#rtp{sdp=rtsp://:${config.port}${config.path || '/audio'}}`
        ].join(' ')

      default:
        throw new Error(`Unsupported protocol: ${config.protocol}`)
    }
  }

  /**
   * Clean up session resources
   */
  private async cleanupSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    try {
      // Remove audio file
      if (session.audioFile) {
        await fs.unlink(session.audioFile).catch((error) => {
          this.log('warn', `Failed to delete audio file: ${session.audioFile}`, error)
        })
      }

      // Update metrics
      if (this.metrics.activeSessions > 0) {
        this.metrics.activeSessions--
      }

      // Remove session
      this.sessions.delete(sessionId)
      
      this.log('info', `Cleaned up VLC streaming session: ${sessionId}`)
    } catch (error) {
      this.log('error', `Failed to cleanup session ${sessionId}`, error)
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys()).filter(sessionId => {
      const session = this.sessions.get(sessionId)
      return session && ['starting', 'active'].includes(session.status)
    })
  }

  /**
   * Clean up all sessions
   */
  async cleanup(): Promise<void> {
    this.log('info', 'Starting service cleanup')
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    const sessionIds = Array.from(this.sessions.keys())
    await Promise.all(sessionIds.map(id => this.stopStream(id)))
    
    this.log('info', 'Service cleanup completed')
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean
    vlcAvailable: boolean
    activeSessions: number
    diskUsage: string
    lastHealthCheck: string
    errors: string[]
  }> {
    const errors: string[] = []
    
    // Check VLC availability
    if (!this.vlcAvailable) {
      await this.checkVLCAvailability()
    }
    
    if (!this.vlcAvailable) {
      errors.push('VLC Media Player not available')
    }

    // Check disk usage
    await this.updateDiskUsage()
    if (this.metrics.diskUsage > PRODUCTION_CONFIG.MAX_TEMP_DIRECTORY_SIZE) {
      errors.push(`Temp directory size exceeds limit: ${Math.round(this.metrics.diskUsage / 1024 / 1024)}MB`)
    }

    // Check for failed sessions
    const failureRate = this.metrics.totalSessions > 0 ? 
      (this.metrics.failedSessions / this.metrics.totalSessions) * 100 : 0
    
    if (failureRate > 50) {
      errors.push(`High failure rate: ${failureRate.toFixed(1)}%`)
    }

    return {
      healthy: errors.length === 0,
      vlcAvailable: this.vlcAvailable || false,
      activeSessions: this.getActiveSessions().length,
      diskUsage: `${Math.round(this.metrics.diskUsage / 1024 / 1024)}MB`,
      lastHealthCheck: this.metrics.lastHealthCheck.toISOString(),
      errors
    }
  }

  /**
   * Get service metrics
   */
  getMetrics(): ServiceMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset metrics (for testing/monitoring)
   */
  resetMetrics(): void {
    this.metrics = {
      totalSessions: 0,
      activeSessions: this.getActiveSessions().length,
      failedSessions: 0,
      audioFilesGenerated: 0,
      diskUsage: this.metrics.diskUsage,
      vlcAvailable: this.metrics.vlcAvailable,
      lastHealthCheck: new Date()
    }
    this.log('info', 'Service metrics reset')
  }
}

// Export singleton instance
export const vlcStreamingService = new VLCStreamingService()
export default vlcStreamingService