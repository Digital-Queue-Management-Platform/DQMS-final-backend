import { Router } from "express"

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
    const { config } = req.body

    if (!config) {
      return res.status(400).json({ error: "Missing configuration" })
    }

    const { ip, port, username, password, model } = config
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

export default router