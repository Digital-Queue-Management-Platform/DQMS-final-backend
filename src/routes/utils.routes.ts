import { Router } from "express"
import axios from "axios"

const router = Router()

/**
 * Auto-translate utility using Google's free API (no key required for low volume)
 */
router.post("/translate", async (req, res) => {
  try {
    const { text, target } = req.body
    if (!text || !target) {
      return res.status(400).json({ error: "Text and target language are required" })
    }

    // Google Translate free endpoint
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${target}&dt=t&q=${encodeURIComponent(text)}`
    
    const response = await axios.get(url)
    
    // Result structure is [[["TranslatedText", "OriginalText", null, null, 1]], null, "en"]
    const translated = response.data[0].map((item: any) => item[0]).join("")

    res.json({ translated })
  } catch (err) {
    console.error("Translation failed:", err)
    res.status(500).json({ error: "Translation failed. Please try again or enter manually." })
  }
})

export default router
