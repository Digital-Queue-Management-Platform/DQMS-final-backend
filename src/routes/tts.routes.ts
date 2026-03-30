import { Router, Request, Response } from "express"
import https from "https"

const router = Router()

// Simple in-memory cache for TTS responses (1 hour TTL)
const ttsCache = new Map<string, { data: Buffer; timestamp: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

// Clean expired cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of ttsCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      ttsCache.delete(key)
    }
  }
}, 15 * 60 * 1000) // Clean every 15 minutes

// Proxy Google Translate TTS for Sinhala and Tamil with caching and retry logic
router.get("/speak", async (req: Request, res: Response) => {
  const { text, lang } = req.query

  if (!text || !lang) {
    return res.status(400).json({ error: "text and lang are required" })
  }

  const allowedLangs = ["si", "ta", "en"]
  if (!allowedLangs.includes(lang as string)) {
    return res.status(400).json({ error: "Unsupported language" })
  }

  // Check cache first
  const cacheKey = `${lang}:${text}`
  const cachedItem = ttsCache.get(cacheKey)
  if (cachedItem && Date.now() - cachedItem.timestamp < CACHE_TTL) {
    res.set("Content-Type", "audio/mpeg")
    res.set("Cache-Control", "public, max-age=3600")
    return res.send(cachedItem.data)
  }

  const encoded = encodeURIComponent(text as string)
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&client=gtx&ttsspeed=0.9`

  const options = {
    timeout: 10000, // 10 second timeout
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  }

  let retries = 0
  const maxRetries = 2

  const attemptRequest = () => {
    const request = https.get(url, options, (googleRes) => {
      if (googleRes.statusCode !== 200) {
        if (retries < maxRetries) {
          retries++
          console.log(`[TTS] HTTP ${googleRes.statusCode}, retry ${retries}/${maxRetries} for ${lang}`)
          setTimeout(attemptRequest, 1000 * retries) // Exponential backoff
        } else if (!res.headersSent) {
          return res.status(502).json({ error: "TTS service unavailable" })
        }
        return
      }

      // Buffer the response for caching
      const chunks: Buffer[] = []
      googleRes.on('data', (chunk) => chunks.push(chunk))
      googleRes.on('end', () => {
        const audioBuffer = Buffer.concat(chunks)
        
        // Cache for future requests
        ttsCache.set(cacheKey, {
          data: audioBuffer,
          timestamp: Date.now()
        })
        
        res.set("Content-Type", "audio/mpeg")
        res.set("Cache-Control", "public, max-age=3600")
        res.send(audioBuffer)
      })
      
      googleRes.on('error', (err) => {
        console.error(`[TTS] Response stream error:`, err.message)
        if (retries < maxRetries) {
          retries++
          console.log(`[TTS] Stream error, retry ${retries}/${maxRetries}`)
          setTimeout(attemptRequest, 1000 * retries)
        } else if (!res.headersSent) {
          res.status(502).json({ error: "TTS response failed" })
        }
      })
    })

    request.on("error", (error) => {
      console.error(`[TTS] Request error:`, error.message)
      if (retries < maxRetries) {
        retries++
        console.log(`[TTS] Network error, retry ${retries}/${maxRetries}`)
        setTimeout(attemptRequest, 1000 * retries)
      } else if (!res.headersSent) {
        res.status(502).json({ error: "TTS request failed" })
      }
    })

    request.on("timeout", () => {
      request.destroy()
      if (retries < maxRetries) {
        retries++
        console.log(`[TTS] Timeout, retry ${retries}/${maxRetries}`)
        setTimeout(attemptRequest, 1000 * retries)
      } else if (!res.headersSent) {
        res.status(504).json({ error: "TTS request timeout" })
      }
    })
  }

  try {
    attemptRequest()
  } catch (err) {
    console.error("[TTS] Unexpected error:", err)
    res.status(500).json({ error: "Internal TTS error" })
  }
})

export default router
