import { Outlet } from "@prisma/client"
import { prisma } from "../server"

/**
 * Utility to broadcast a voice announcement to a physical IP speaker if configured for an outlet.
 */
export async function announceToIpSpeaker(outletId: string, text: string, lang: string = 'en') {
  try {
    const outlet = await prisma.outlet.findUnique({
      where: { id: outletId },
      select: { displaySettings: true }
    })

    const settings = (outlet?.displaySettings as any) || {}
    if (!settings.useIPSpeaker || !settings.ipSpeakerConfig) return

    const ipConfig = settings.ipSpeakerConfig
    const authHeader = ipConfig.username && ipConfig.password
      ? `Basic ${Buffer.from(`${ipConfig.username}:${ipConfig.password}`).toString('base64')}`
      : undefined

    const baseUrl = `http://${ipConfig.ip}:${ipConfig.port || 80}`
    let targetUrl = ""
    let body: any = {}

    if (ipConfig.model === 'hikvision') {
      targetUrl = `${baseUrl}/ISAPI/AudioIntercom/audioInputChannels/1/announcement`
      body = { 
        AudioIntercom: { 
          audioInputChannelID: 1, 
          announcement: { text: text, volume: 100, language: lang } 
        } 
      }
    } else if (ipConfig.model === 'dahua') {
      targetUrl = `${baseUrl}/cgi-bin/announcements.cgi?action=play`
      body = { action: 'play', text: text, volume: 100, language: lang }
    } else if (ipConfig.model === 'axis') {
      targetUrl = `${baseUrl}/axis-cgi/audio/play.cgi`
      body = { text: text, volume: 100, voice: lang }
    } else {
      // Default generic
      targetUrl = `${baseUrl}/announce`
      body = { message: text, volume: 100, language: lang }
    }

    console.log(`[IP-Speaker] Triggering hardware broadcast to ${targetUrl} with volume 100`)
    
    // We use a non-blocking fetch here
    fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader && { 'Authorization': authHeader })
      },
      body: JSON.stringify(body)
    }).catch(e => console.error(`[IP-Speaker] Fetch failed for ${outletId}:`, e.message))

  } catch (err) {
    console.error(`[IP-Speaker] Announcement utility error for outlet ${outletId}:`, err)
  }
}
