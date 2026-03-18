import dotenv from 'dotenv'

dotenv.config()

/**
 * Get the base URL for the frontend.
 * Prioritizes SLT production URL with port if available, then other SLT urls, then Vercel.
 */
export function getFrontendBaseUrl(): string {
  const origins = (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (origins.length === 0) {
    return 'http://localhost:3000'
  }

  // 1. Prioritize SLT domain WITH Port :7443 (common in your environment)
  const sltWithPort = origins.find(o => o.includes('slt.lk') && o.includes(':7443'))
  if (sltWithPort) return sltWithPort.replace(/\/$/, '')

  // 2. Fallback to any SLT domain
  const sltUrl = origins.find(o => o.includes('slt.lk'))
  if (sltUrl) return sltUrl.replace(/\/$/, '')

  // 3. Fallback to production-like URLs (https but not vercel/localhost)
  const prodUrl = origins.find(o => o.startsWith('https://') && !o.includes('vercel.app') && !o.includes('localhost'))
  if (prodUrl) return prodUrl.replace(/\/$/, '')

  // 4. Fallback to Vercel
  const vercelUrl = origins.find(o => o.includes('vercel.app'))
  if (vercelUrl) return vercelUrl.replace(/\/$/, '')

  // 5. Default to the first origin in the list
  return origins[0].replace(/\/$/, '')
}

/**
 * Get the tracking URL for a token
 */
export function getTrackingUrl(tokenId: string): string {
  const baseUrl = getFrontendBaseUrl()
  const shortId = tokenId.substring(0, 8)
  return `${baseUrl}/t/${shortId}`
}

/**
 * Get the recovery URL for a customer lookup
 */
export function getRecoveryUrl(mobileNumber: string, outletId?: string): string {
  const baseUrl = getFrontendBaseUrl()
  const shortOutlet = outletId ? outletId.substring(0, 8) : 'default'
  return `${baseUrl}/r?o=${shortOutlet}&m=${encodeURIComponent(mobileNumber)}`
}

/**
 * Get the feedback URL for a token
 */
export function getFeedbackUrl(tokenId: string): string {
  const baseUrl = getFrontendBaseUrl()
  const shortId = tokenId.substring(0, 8)
  return `${baseUrl}/f/${shortId}`
}

/**
 * Get the service status URL with reference
 */
export function getServiceStatusUrl(ref: string): string {
  const baseUrl = getFrontendBaseUrl()
  return `${baseUrl}/service/status?ref=${encodeURIComponent(ref)}`
}
