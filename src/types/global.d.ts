// Global type declarations for audio event storage
declare global {
  var recentAudioEvents: Array<{
    id: string
    outletId: string
    type: string
    testType?: string | null
    lang?: string | null
    customText?: string | null
    chimeVolume?: number
    voiceVolume?: number
    timestamp: string
    tokenData?: {
      tokenNumber: string | number
      counterNumber: number
      customerName: string
    }
  }>
}

export {}