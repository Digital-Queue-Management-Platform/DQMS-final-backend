import { Router } from "express"
import multer from "multer"
import path from "path"
import { prisma } from "../server"

const router = Router()

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/")
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
})

// Upload document
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" })
    }

    const { uploadedBy, relatedEntity } = req.body

    const document = await prisma.document.create({
      data: {
        filename: req.file.originalname,
        filepath: req.file.path,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedBy,
        relatedEntity,
      },
    })

    res.json({ success: true, document })
  } catch (error) {
    console.error("Upload error:", error)
    res.status(500).json({ error: "Failed to upload document" })
  }
})

// Get documents for entity
router.get("/:relatedEntity", async (req, res) => {
  try {
    const { relatedEntity } = req.params

    const documents = await prisma.document.findMany({
      where: { relatedEntity },
      orderBy: { createdAt: "desc" },
    })

    res.json(documents)
  } catch (error) {
    console.error("Documents fetch error:", error)
    res.status(500).json({ error: "Failed to fetch documents" })
  }
})

export default router
