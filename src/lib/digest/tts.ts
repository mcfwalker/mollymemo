// Text-to-Speech integration using OpenAI TTS API
// Converts digest scripts to audio for Telegram voice messages

export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer'

export interface TTSOptions {
  voice?: TTSVoice
  model?: 'tts-1' | 'tts-1-hd'
}

const DEFAULT_OPTIONS: Required<TTSOptions> = {
  voice: 'alloy', // Neutral, balanced — selected for Imogen
  model: 'tts-1', // Standard quality, faster
}

export async function textToSpeech(
  text: string,
  options: TTSOptions = {}
): Promise<Buffer> {
  const { voice, model } = { ...DEFAULT_OPTIONS, ...options }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: 'opus', // Telegram-native format
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI TTS error: ${response.status} - ${error}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// Calculate approximate cost for TTS
// OpenAI TTS pricing: $0.015 per 1K characters (tts-1)
export function estimateTTSCost(text: string): number {
  const characters = text.length
  return (characters / 1000) * 0.015
}
