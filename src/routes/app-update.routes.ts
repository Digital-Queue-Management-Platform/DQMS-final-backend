import express from 'express'
import fs from 'fs'
import path from 'path'
import { logger } from '../server'

const router = express.Router()

// ❗ UPDATE THIS VERSION WHEN YOU BUILD A NEW APK
const CURRENT_APP_VERSION = '1.0.1'

// Where the APK file is stored (uploads folder)
const getApkPath = () => {
  const PROJECT_ROOT = path.resolve(__dirname, '..')
  return path.join(PROJECT_ROOT, '..', 'uploads', 'app.apk')
}

/**
 * GET /api/app/check-update
 * Android TV device calls this to check if a new version is available
 * 
 * Query params:
 * - version: Current app version on device (e.g., "1.0.0")
 * 
 * Response:
 * {
 *   "latestVersion": "1.0.1",
 *   "hasUpdate": true,
 *   "downloadUrl": "https://yourserver.com/api/app/download",
 *   "changelog": "Bug fixes and improvements"
 * }
 */
router.get('/check-update', (req, res) => {
  try {
    const deviceVersion = (req.query.version as string) || '0.0.0'
    
    logger.info(
      { deviceVersion, currentVersion: CURRENT_APP_VERSION },
      'APP_UPDATE_CHECK'
    )

    // Simple version comparison (assumes semantic versioning like "1.0.0")
    const hasUpdate = compareVersions(deviceVersion, CURRENT_APP_VERSION) < 0

    const protocol = req.protocol
    const host = req.get('host')
    const downloadUrl = `${protocol}://${host}/api/app/download`

    res.json({
      latestVersion: CURRENT_APP_VERSION,
      hasUpdate,
      downloadUrl,
      changelog: 'Bug fixes and improvements',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    logger.error({ error: error.message }, 'APP_UPDATE_CHECK_ERROR')
    res.status(500).json({ error: 'Failed to check for updates' })
  }
})

/**
 * GET /api/app/download
 * Android TV device downloads the APK from this endpoint
 * 
 * Response: APK binary file
 */
router.get('/download', (req, res) => {
  try {
    const apkPath = getApkPath()

    if (!fs.existsSync(apkPath)) {
      logger.warn({ apkPath }, 'APK_NOT_FOUND')
      return res.status(404).json({ error: 'APK not found on server' })
    }

    const stats = fs.statSync(apkPath)
    logger.info(
      { apkPath, fileSizeBytes: stats.size },
      'APP_DOWNLOAD_STARTED'
    )

    res.setHeader('Content-Type', 'application/vnd.android.package-archive')
    res.setHeader('Content-Disposition', 'attachment; filename="app.apk"')
    res.setHeader('Content-Length', stats.size)

    const fileStream = fs.createReadStream(apkPath)
    
    fileStream.on('error', (error) => {
      logger.error({ error: error.message }, 'APK_DOWNLOAD_STREAM_ERROR')
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download APK' })
      }
    })

    fileStream.pipe(res)

    res.on('finish', () => {
      logger.info({ apkPath }, 'APP_DOWNLOAD_COMPLETED')
    })
  } catch (error: any) {
    logger.error({ error: error.message }, 'APP_DOWNLOAD_ERROR')
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download APK' })
    }
  }
})

/**
 * GET /api/app/version
 * Returns the current app version (useful for debugging)
 */
router.get('/version', (req, res) => {
  try {
    const apkPath = getApkPath()
    const apkExists = fs.existsSync(apkPath)
    const apkSize = apkExists ? fs.statSync(apkPath).size : 0

    res.json({
      currentVersion: CURRENT_APP_VERSION,
      apkAvailable: apkExists,
      apkSize: apkSize,
      apkPath: process.env.NODE_ENV === 'development' ? apkPath : 'hidden',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    logger.error({ error: error.message }, 'APP_VERSION_ERROR')
    res.status(500).json({ error: 'Failed to get app version' })
  }
})

/**
 * Helper: Compare two semantic versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0

    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }

  return 0
}

export default router
