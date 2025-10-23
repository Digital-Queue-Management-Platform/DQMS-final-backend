import { Router } from "express"
import vlcStreamingService from "../services/vlcStreamingService"

const router = Router()

// IP Speaker manufacturers and their API endpoints
const IP_SPEAKER_APIS = {
  hikvision: {
    testEndpoint: '/ISAPI/System/deviceInfo',
    announceEndpoint: '/ISAPI/AudioIntercom/audioInputChannels/1/announcement',
    stopEndpoint: '/ISAPI/AudioIntercom/audioInputChannels/1/stopAnnouncement',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'basic'
  },
  dahua: {
    testEndpoint: '/cgi-bin/magicBox.cgi?action=getSystemInfo',
    announceEndpoint: '/cgi-bin/announcements.cgi?action=play',
    stopEndpoint: '/cgi-bin/announcements.cgi?action=stop',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'basic'
  },
  axis: {
    testEndpoint: '/axis-cgi/vapix/basic_device_info.cgi',
    announceEndpoint: '/axis-cgi/audio/play.cgi',
    stopEndpoint: '/axis-cgi/audio/stop.cgi',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'digest'
  },
  onvif: {
    testEndpoint: '/onvif/device_service',
    announceEndpoint: '/onvif/media_service',
    stopEndpoint: '/onvif/media_service',
    method: 'POST',
    announceMethod: 'POST',
    authType: 'digest',
    protocol: 'soap'
  },
  rtsp: {
    testEndpoint: '/describe',
    announceEndpoint: '/announce',
    stopEndpoint: '/teardown',
    method: 'DESCRIBE',
    announceMethod: 'ANNOUNCE',
    authType: 'basic',
    protocol: 'rtsp'
  },
  generic: {
    testEndpoint: '/status',
    announceEndpoint: '/announce',
    stopEndpoint: '/stop',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'basic'
  },
  restful: {
    testEndpoint: '/api/status',
    announceEndpoint: '/api/tts/speak',
    stopEndpoint: '/api/tts/stop',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'bearer'
  },
  webhook: {
    testEndpoint: '/health',
    announceEndpoint: '/webhook/announce',
    stopEndpoint: '/webhook/stop',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'none'
  },
  custom: {
    testEndpoint: '/test',
    announceEndpoint: '/speak',
    stopEndpoint: '/stop',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'custom'
  },
  vlc_http: {
    testEndpoint: '/status.xml',
    announceEndpoint: '/stream/announce',
    stopEndpoint: '/stream/stop',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'none',
    protocol: 'http',
    streamType: 'vlc'
  },
  vlc_udp: {
    testEndpoint: '/status',
    announceEndpoint: '/stream/udp',
    stopEndpoint: '/stream/stop',
    method: 'GET',
    announceMethod: 'POST',
    authType: 'none',
    protocol: 'udp',
    streamType: 'vlc'
  },
  vlc_rtsp: {
    testEndpoint: '/describe',
    announceEndpoint: '/stream/rtsp',
    stopEndpoint: '/stream/stop',
    method: 'DESCRIBE',
    announceMethod: 'ANNOUNCE',
    authType: 'none',
    protocol: 'rtsp',
    streamType: 'vlc'
  }
}

// Auto-detect IP speaker type
router.post("/detect", async (req, res) => {
  try {
    const { ip, port, username, password } = req.body

    if (!ip || !port) {
      return res.status(400).json({ error: "Missing IP and port parameters" })
    }

    const detectionResults = []
    const baseUrl = `http://${ip}:${port}`

    // Try each protocol in order of likelihood
    const protocolsToTry = ['hikvision', 'dahua', 'axis', 'onvif', 'generic', 'restful', 'webhook']

    for (const protocol of protocolsToTry) {
      const apiConfig = IP_SPEAKER_APIS[protocol as keyof typeof IP_SPEAKER_APIS]
      const testUrl = `${baseUrl}${apiConfig.testEndpoint}`

      try {
        const authHeader = username && password 
          ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
          : undefined

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000) // Quick 3-second timeout for detection

        const response = await fetch(testUrl, {
          method: apiConfig.method || 'GET',
          headers: {
            'User-Agent': 'DQMS-IP-Speaker-Detection/1.0',
            ...(authHeader && { Authorization: authHeader }),
          },
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        detectionResults.push({
          protocol,
          status: response.status,
          success: response.status < 400,
          url: testUrl,
          headers: Object.fromEntries(response.headers.entries())
        })

        // If we get a successful response, this is likely the correct protocol
        if (response.status < 400) {
          return res.json({
            success: true,
            detectedProtocol: protocol,
            recommendedModel: protocol,
            message: `Detected ${protocol} protocol`,
            allResults: detectionResults
          })
        }

      } catch (error: any) {
        detectionResults.push({
          protocol,
          success: false,
          error: error.message,
          url: testUrl
        })
      }
    }

    // No protocol worked, return results for manual configuration
    res.json({
      success: false,
      message: "Could not auto-detect protocol. Try manual configuration.",
      recommendedModel: 'custom',
      allResults: detectionResults
    })

  } catch (error) {
    console.error("Detection error:", error)
    res.status(500).json({ error: "Detection failed" })
  }
})

// Test IP speaker connection
router.post("/test", async (req, res) => {
  try {
    const { ip, port, username, password, model, apiToken } = req.body

    if (!ip || !port || !model) {
      return res.status(400).json({ error: "Missing required parameters" })
    }

    const apiConfig = IP_SPEAKER_APIS[model as keyof typeof IP_SPEAKER_APIS]
    if (!apiConfig) {
      return res.status(400).json({ error: "Unsupported IP speaker model" })
    }

    const baseUrl = `http://${ip}:${port}`
    const testUrl = `${baseUrl}${apiConfig.testEndpoint}`

    console.log(`Testing IP speaker connection: ${testUrl} using ${model} protocol`)

    // Create authentication header based on auth type
    let authHeader: string | undefined
    const headers: Record<string, string> = {
      'User-Agent': 'DQMS-IP-Speaker/1.0',
      'Content-Type': 'application/json',
    }

    if (apiConfig.authType === 'basic' && username && password) {
      authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      headers.Authorization = authHeader
    } else if (apiConfig.authType === 'bearer' && apiToken) {
      headers.Authorization = `Bearer ${apiToken}`
    } else if (apiConfig.authType === 'custom' && apiToken) {
      headers['X-API-Key'] = apiToken
    }

    // Test connection with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000) // 8 second timeout for universal compatibility

    try {
      const response = await fetch(testUrl, {
        method: apiConfig.method || 'GET',
        headers,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok || response.status === 401) {
        // 401 is also acceptable - means device is responding but needs auth
        res.json({ 
          success: true, 
          status: response.status,
          message: response.status === 401 ? 'Device found, check credentials' : 'Connection successful'
        })
      } else {
        res.status(response.status).json({ 
          error: `IP speaker responded with status ${response.status}` 
        })
      }

    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      
      if (fetchError.name === 'AbortError') {
        res.status(408).json({ error: "Connection timeout - check IP and port" })
      } else {
        res.status(500).json({ 
          error: `Connection failed: ${fetchError.message}`,
          details: "Check IP address, port, and network connectivity"
        })
      }
    }

  } catch (error) {
    console.error("IP speaker test error:", error)
    res.status(500).json({ error: "Failed to test IP speaker connection" })
  }
})

// Send announcement to IP speaker
router.post("/announce", async (req, res) => {
  try {
    const { config, text, language, volume } = req.body

    if (!config || !text) {
      return res.status(400).json({ error: "Missing configuration or text" })
    }

    const { ip, port, username, password, model } = config
    const apiConfig = IP_SPEAKER_APIS[model as keyof typeof IP_SPEAKER_APIS]
    
    if (!apiConfig) {
      return res.status(400).json({ error: "Unsupported IP speaker model" })
    }

    const baseUrl = `http://${ip}:${port}`
    const announceUrl = `${baseUrl}${apiConfig.announceEndpoint}`

    console.log(`Sending announcement to IP speaker: ${announceUrl}`)
    console.log(`Text: ${text}`)
    console.log(`Language: ${language}`)

    // Create authentication header
    const authHeader = username && password 
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : undefined

    // Prepare announcement data based on speaker model
    let requestBody: any
    let contentType = 'application/json'

    // Handle VLC streaming
    if (model.startsWith('vlc_')) {
      const protocol = model.replace('vlc_', '') as 'http' | 'udp' | 'rtsp'
      const sessionId = `${ip}_${port}_${Date.now()}`
      
      const vlcConfig = {
        protocol,
        port: port,
        ip: ip,
        path: '/audio',
        multicast: protocol === 'udp' // Enable multicast for UDP
      }

      try {
        const success = await vlcStreamingService.startStream(sessionId, text, language, vlcConfig)
        
        if (success) {
          res.json({ 
            success: true, 
            message: `VLC ${protocol.toUpperCase()} stream started successfully`,
            sessionId,
            streamUrl: protocol === 'http' ? `http://${ip}:${port}/audio` :
                      protocol === 'udp' ? `udp://${ip}:${port}` :
                      `rtsp://${ip}:${port}/audio`
          })
        } else {
          res.status(500).json({ error: 'Failed to start VLC stream' })
        }
        return
      } catch (vlcError: any) {
        res.status(500).json({ 
          error: `VLC streaming error: ${vlcError.message}`,
          details: 'Make sure VLC is installed and accessible'
        })
        return
      }
    }

    switch (model) {
      case 'hikvision':
        requestBody = JSON.stringify({
          AudioIntercom: {
            audioInputChannelID: 1,
            announcement: {
              text: text,
              volume: volume || 80,
              language: language || 'en'
            }
          }
        })
        break

      case 'dahua':
        requestBody = JSON.stringify({
          action: 'play',
          text: text,
          volume: volume || 80,
          language: language || 'en'
        })
        break

      case 'axis':
        requestBody = JSON.stringify({
          text: text,
          volume: volume || 80,
          voice: language || 'en'
        })
        break

      case 'generic':
      default:
        requestBody = JSON.stringify({
          message: text,
          volume: volume || 80,
          language: language || 'en'
        })
        break
    }

    // Send announcement with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

    try {
      const response = await fetch(announceUrl, {
        method: 'POST',
        headers: {
          ...(authHeader && { Authorization: authHeader }),
          'Content-Type': contentType,
        },
        body: requestBody,
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        res.json({ 
          success: true, 
          message: 'Announcement sent successfully',
          speakerResponse: response.status
        })
      } else {
        const errorText = await response.text().catch(() => 'Unknown error')
        res.status(response.status).json({ 
          error: `IP speaker error: ${response.status}`,
          details: errorText
        })
      }

    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      
      if (fetchError.name === 'AbortError') {
        res.status(408).json({ error: "Announcement timeout" })
      } else {
        res.status(500).json({ 
          error: `Failed to send announcement: ${fetchError.message}` 
        })
      }
    }

  } catch (error) {
    console.error("IP speaker announce error:", error)
    res.status(500).json({ error: "Failed to send announcement" })
  }
})

// Stop current announcement
router.post("/stop", async (req, res) => {
  try {
    const { config, sessionId } = req.body

    if (!config) {
      return res.status(400).json({ error: "Missing configuration" })
    }

    const { ip, port, username, password, model } = config

    // Handle VLC streaming stop
    if (model.startsWith('vlc_') && sessionId) {
      try {
        const success = await vlcStreamingService.stopStream(sessionId)
        
        if (success) {
          res.json({ 
            success: true, 
            message: 'VLC stream stopped successfully' 
          })
        } else {
          res.status(404).json({ 
            error: 'Stream session not found or already stopped' 
          })
        }
        return
      } catch (vlcError: any) {
        res.status(500).json({ 
          error: `Failed to stop VLC stream: ${vlcError.message}` 
        })
        return
      }
    }

    const apiConfig = IP_SPEAKER_APIS[model as keyof typeof IP_SPEAKER_APIS]
    
    if (!apiConfig) {
      return res.status(400).json({ error: "Unsupported IP speaker model" })
    }

    const baseUrl = `http://${ip}:${port}`
    const stopUrl = `${baseUrl}${apiConfig.stopEndpoint}`

    console.log(`Stopping announcement on IP speaker: ${stopUrl}`)

    // Create authentication header
    const authHeader = username && password 
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : undefined

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    try {
      const response = await fetch(stopUrl, {
        method: 'POST',
        headers: {
          ...(authHeader && { Authorization: authHeader }),
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        res.json({ 
          success: true, 
          message: 'Announcement stopped successfully' 
        })
      } else {
        res.status(response.status).json({ 
          error: `Failed to stop announcement: ${response.status}` 
        })
      }

    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      res.status(500).json({ 
        error: `Failed to stop announcement: ${fetchError.message}` 
      })
    }

  } catch (error) {
    console.error("IP speaker stop error:", error)
    res.status(500).json({ error: "Failed to stop announcement" })
  }
})

// Get supported IP speaker models
router.get("/models", (req, res) => {
  res.json({
    models: Object.keys(IP_SPEAKER_APIS).map(model => ({
      id: model,
      name: model.charAt(0).toUpperCase() + model.slice(1),
      description: `${model.charAt(0).toUpperCase() + model.slice(1)} IP Speaker`
    }))
  })
})

// Get VLC streaming sessions status
router.get("/vlc/sessions", (req, res) => {
  try {
    const activeSessions = vlcStreamingService.getActiveSessions()
    res.json({
      success: true,
      activeSessions,
      count: activeSessions.length
    })
  } catch (error) {
    console.error("Failed to get VLC sessions:", error)
    res.status(500).json({ error: "Failed to get streaming sessions" })
  }
})

// Get specific VLC session status
router.get("/vlc/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params
    const status = vlcStreamingService.getSessionStatus(sessionId)
    
    if (status) {
      res.json({
        success: true,
        sessionId,
        status
      })
    } else {
      res.status(404).json({
        error: "Session not found"
      })
    }
  } catch (error) {
    console.error("Failed to get VLC session status:", error)
    res.status(500).json({ error: "Failed to get session status" })
  }
})

// Health check endpoint
router.get("/health", async (req, res) => {
  try {
    const health = await vlcStreamingService.getHealthStatus()
    
    if (health.healthy) {
      res.json({
        status: "healthy",
        ...health
      })
    } else {
      res.status(503).json({
        status: "unhealthy",
        ...health
      })
    }
  } catch (error) {
    console.error("Health check failed:", error)
    res.status(500).json({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error"
    })
  }
})

// Metrics endpoint
router.get("/metrics", (req, res) => {
  try {
    const metrics = vlcStreamingService.getMetrics()
    res.json({
      success: true,
      metrics
    })
  } catch (error) {
    console.error("Failed to get metrics:", error)
    res.status(500).json({ error: "Failed to get metrics" })
  }
})

// Reset metrics endpoint (for monitoring/testing)
router.post("/metrics/reset", (req, res) => {
  try {
    vlcStreamingService.resetMetrics()
    res.json({
      success: true,
      message: "Metrics reset successfully"
    })
  } catch (error) {
    console.error("Failed to reset metrics:", error)
    res.status(500).json({ error: "Failed to reset metrics" })
  }
})

// Audio streaming endpoint for hosted environments
router.get("/audio/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params
    
    // Check if session exists
    const status = vlcStreamingService.getSessionStatus(sessionId)
    if (!status) {
      return res.status(404).json({ error: "Session not found" })
    }

    // Get audio file path
    const audioFilePath = vlcStreamingService.getAudioFilePath(sessionId)
    if (!audioFilePath) {
      return res.status(404).json({ error: "Audio file not found" })
    }

    // Check if file exists
    const fs = require('fs')
    if (!fs.existsSync(audioFilePath)) {
      return res.status(404).json({ error: "Audio file does not exist" })
    }

    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET')
    
    // Stream the audio file
    const readStream = fs.createReadStream(audioFilePath)
    readStream.pipe(res)
    
    readStream.on('error', (error: any) => {
      console.error('Audio streaming error:', error)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Audio streaming failed' })
      }
    })
    
  } catch (error) {
    console.error("Audio streaming failed:", error)
    if (!res.headersSent) {
      res.status(500).json({ error: "Audio streaming failed" })
    }
  }
})

// Environment detection endpoint
router.get("/environment", (req, res) => {
  try {
    const isHosted = !vlcStreamingService.getMetrics().vlcAvailable
    const environment = process.env.NODE_ENV || 'development'
    const serverInfo = {
      environment,
      isHosted,
      vlcAvailable: vlcStreamingService.getMetrics().vlcAvailable,
      supportedFeatures: {
        vlcStreaming: vlcStreamingService.getMetrics().vlcAvailable,
        webStreaming: true,
        browserSynthesis: true,
        audioFileStreaming: true
      },
      recommendedMode: vlcStreamingService.getMetrics().vlcAvailable ? 'vlc' : 'web'
    }
    
    res.json({
      success: true,
      ...serverInfo
    })
  } catch (error) {
    console.error("Environment detection failed:", error)
    res.status(500).json({ error: "Environment detection failed" })
  }
})

export default router