// Telegram voice message delivery
// Sends audio digests to users via Telegram's sendVoice API

const TELEGRAM_API = 'https://api.telegram.org/bot'

export interface SendVoiceResult {
  success: boolean
  fileId?: string
  error?: string
}

export async function sendVoiceMessage(
  chatId: number,
  audioBuffer: Buffer,
  duration: number,
  caption?: string
): Promise<SendVoiceResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return { success: false, error: 'TELEGRAM_BOT_TOKEN not configured' }
  }

  try {
    // Create form data with the audio file
    // Convert Buffer to Uint8Array for Blob compatibility
    const audioData = new Uint8Array(audioBuffer)
    const formData = new FormData()
    formData.append('chat_id', chatId.toString())
    formData.append(
      'voice',
      new Blob([audioData], { type: 'audio/ogg' }),
      'digest.ogg'
    )
    formData.append('duration', duration.toString())

    if (caption) {
      formData.append('caption', caption)
    }

    const response = await fetch(`${TELEGRAM_API}${token}/sendVoice`, {
      method: 'POST',
      body: formData,
    })

    const data = await response.json()

    if (!data.ok) {
      console.error('Telegram sendVoice error:', data)
      return { success: false, error: data.description || 'Unknown error' }
    }

    return {
      success: true,
      fileId: data.result?.voice?.file_id,
    }
  } catch (error) {
    console.error('Failed to send voice message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Send a simple text message (for empty days or errors)
export async function sendTextMessage(
  chatId: number,
  text: string
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return false
  }

  try {
    const response = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    })

    const data = await response.json()
    return data.ok
  } catch (error) {
    console.error('Failed to send text message:', error)
    return false
  }
}
