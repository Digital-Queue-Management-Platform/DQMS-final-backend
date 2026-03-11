import { Router, Request, Response } from "express"
import https from "https"

const router = Router()

// Proxy Google Translate TTS for Sinhala and Tamil (browser Speech API has no native voices)
router.get("/speak", async (req: Request, res: Response) => {
  const { text, lang } = req.query

  if (!text || !lang) {
    return res.status(400).json({ error: "text and lang are required" })
  }

  const allowedLangs = ["si", "ta", "en"]
  if (!allowedLangs.includes(lang as string)) {
    return res.status(400).json({ error: "Unsupported language" })
  }

  const encoded = encodeURIComponent(text as string)
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&client=gtx&ttsspeed=0.9`

  const options = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  }

  try {
    const request = https.get(url, options, (googleRes) => {
      if (googleRes.statusCode !== 200) {
        return res.status(502).json({ error: "TTS service unavailable" })
      }
      res.set("Content-Type", "audio/mpeg")
      res.set("Cache-Control", "no-store")
      googleRes.pipe(res)
    })

    request.on("error", () => {
      if (!res.headersSent) {
        res.status(502).json({ error: "TTS request failed" })
      }
    })
  } catch {
    res.status(500).json({ error: "Internal TTS error" })
  }
})

export default router
