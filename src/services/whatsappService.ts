import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { systemLogger } from './systemLogger'

// Ensure uploads/reports folder exists for backups/local mock files
const REPORTS_DIR = path.join(process.cwd(), 'uploads', 'reports')
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true })
}

export class WhatsAppService {
  private provider: string
  private token: string
  private instanceId: string
  private groupId: string
  private apiUrl: string

  constructor() {
    this.provider = (process.env.WHATSAPP_PROVIDER || 'mock').toLowerCase()
    this.token = process.env.WHATSAPP_TOKEN || ''
    this.instanceId = process.env.WHATSAPP_INSTANCE_ID || ''
    this.groupId = process.env.WHATSAPP_GROUP_ID || ''
    this.apiUrl = process.env.WHATSAPP_API_URL || ''
  }

  /**
   * Sends the insights PDF report to the configured WhatsApp group.
   * Falls back to saving locally if mock provider is selected or configs are missing.
   * 
   * @param pdfBuffer The compiled PDF file buffer.
   * @param filename Filename for the PDF.
   * @param caption Description or greeting sent alongside the PDF.
   * @returns Promise<boolean> True if successfully sent/mocked, false otherwise.
   */
  async sendInsightsReport(pdfBuffer: Buffer, filename: string, caption: string): Promise<boolean> {
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-')
    const localFilePath = path.join(REPORTS_DIR, `${timestampStr}_${filename}`)

    // 1. Always save a local copy as an archive/backup
    try {
      fs.writeFileSync(localFilePath, pdfBuffer)
      systemLogger.info(`Local backup of PDF report saved successfully`, {
        service: 'backend',
        module: 'whatsapp',
        event: 'pdf-backup-saved',
        metadata: { path: localFilePath }
      })
    } catch (err: any) {
      console.error('Failed to save local PDF backup:', err)
    }

    // 2. Validate configurations for real providers
    if (this.provider !== 'mock') {
      if (!this.token || !this.groupId || (!this.instanceId && this.provider !== 'generic')) {
        systemLogger.warn('WhatsApp service configuration is incomplete. Falling back to mock (local save) mode.', {
          service: 'backend',
          module: 'whatsapp',
          event: 'config-missing-fallback',
          metadata: { provider: this.provider, hasToken: !!this.token, hasGroupId: !!this.groupId, hasInstanceId: !!this.instanceId }
        })
        this.provider = 'mock'
      }
    }

    // 3. Execute sending based on provider
    try {
      switch (this.provider) {
        case 'greenapi':
          return await this.sendViaGreenApi(pdfBuffer, filename, caption)
        
        case 'ultramsg':
          return await this.sendViaUltraMsg(pdfBuffer, filename, caption)

        case 'mock':
        default:
          return this.sendViaMock(localFilePath, filename, caption)
      }
    } catch (error: any) {
      systemLogger.error(`WhatsApp report delivery failed for provider: ${this.provider}`, {
        service: 'backend',
        module: 'whatsapp',
        event: 'delivery-failed',
        metadata: { error: error.message },
        stackTrace: error.stack
      })
      console.error(`WhatsApp delivery error (${this.provider}):`, error)
      return false
    }
  }

  /**
   * Mock sending by simulating the process, writing logs, and keeping the file locally.
   */
  private sendViaMock(localPath: string, filename: string, caption: string): boolean {
    console.log(`[WHATSAPP MOCK] Message triggered at ${new Date().toLocaleString()}`)
    console.log(`[WHATSAPP MOCK] To Group ID: ${this.groupId || 'demo-group-12345'}`)
    console.log(`[WHATSAPP MOCK] File attached: ${filename} (Saved to: ${localPath})`)
    console.log(`[WHATSAPP MOCK] Caption: ${caption}`)

    systemLogger.info(`[MOCK] Automated PDF report generated and stored successfully.`, {
      service: 'backend',
      module: 'whatsapp',
      event: 'mock-delivery-success',
      metadata: {
        targetGroup: this.groupId || 'demo-group-12345',
        filename,
        storedPath: localPath,
        caption
      }
    })

    return true
  }

  /**
   * Sends PDF file via GreenAPI sendFileByUpload endpoint.
   */
  private async sendViaGreenApi(pdfBuffer: Buffer, filename: string, caption: string): Promise<boolean> {
    const baseUrl = this.apiUrl || 'https://api.green-api.com'
    const url = `${baseUrl}/waInstance${this.instanceId}/sendFileByUpload/${this.token}`

    systemLogger.info('Initiating report transfer via GreenAPI', {
      service: 'backend',
      module: 'whatsapp',
      event: 'greenapi-transfer-started',
      metadata: { url, groupId: this.groupId }
    })

    // Create native form-data payload (compatible with Node 18+)
    const formData = new FormData()
    formData.append('chatId', this.groupId)
    formData.append('caption', caption)
    
    // Convert Buffer to Blob for native FormData compatibility
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' })
    formData.append('file', blob, filename)

    const response = await axios.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 30000 // 30 seconds
    })

    if (response.data && (response.data.idMessage || response.data.sent === true)) {
      systemLogger.info('Report sent successfully to WhatsApp group via GreenAPI', {
        service: 'backend',
        module: 'whatsapp',
        event: 'greenapi-delivery-success',
        metadata: { messageId: response.data.idMessage, response: response.data }
      })
      return true
    } else {
      throw new Error(`Unexpected GreenAPI response: ${JSON.stringify(response.data)}`)
    }
  }

  /**
   * Sends PDF file via UltraMsg API.
   * It uploads the local file buffer to UltraMsg CDN, then sends the CDN URL as a document.
   */
  private async sendViaUltraMsg(pdfBuffer: Buffer, filename: string, caption: string): Promise<boolean> {
    const baseUrl = this.apiUrl || 'https://api.ultramsg.com'
    const uploadUrl = `${baseUrl}/${this.instanceId}/media/upload`
    const sendDocUrl = `${baseUrl}/${this.instanceId}/messages/document`

    systemLogger.info('Initiating report transfer via UltraMsg (Step 1: Media Upload)', {
      service: 'backend',
      module: 'whatsapp',
      event: 'ultramsg-upload-started',
      metadata: { uploadUrl, groupId: this.groupId }
    })

    // Step 1: Upload PDF buffer to UltraMsg CDN
    const uploadForm = new FormData()
    uploadForm.append('token', this.token)
    
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' })
    uploadForm.append('file', blob, filename)

    const uploadResponse = await axios.post(uploadUrl, uploadForm, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 30000
    })

    // UltraMsg media upload returns the public file URL directly, or inside a nested object
    const cdnUrl = uploadResponse.data?.url || uploadResponse.data
    if (!cdnUrl || typeof cdnUrl !== 'string') {
      throw new Error(`Failed to upload report to UltraMsg CDN. Response: ${JSON.stringify(uploadResponse.data)}`)
    }

    systemLogger.info('Report uploaded to UltraMsg CDN (Step 2: Sending Document)', {
      service: 'backend',
      module: 'whatsapp',
      event: 'ultramsg-send-started',
      metadata: { sendDocUrl, cdnUrl }
    })

    // Step 2: Send the uploaded document to the WhatsApp Group JID
    const params = new URLSearchParams()
    params.append('token', this.token)
    params.append('to', this.groupId)
    params.append('filename', filename)
    params.append('document', cdnUrl)
    params.append('caption', caption)

    const sendResponse = await axios.post(sendDocUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000
    })

    if (sendResponse.data && (sendResponse.data.sent === 'true' || sendResponse.data.success || sendResponse.data.id)) {
      systemLogger.info('Report sent successfully to WhatsApp group via UltraMsg', {
        service: 'backend',
        module: 'whatsapp',
        event: 'ultramsg-delivery-success',
        metadata: { messageId: sendResponse.data.id, response: sendResponse.data }
      })
      return true
    } else {
      throw new Error(`UltraMsg dispatch failed. Response: ${JSON.stringify(sendResponse.data)}`)
    }
  }
}

export const whatsappService = new WhatsAppService()
