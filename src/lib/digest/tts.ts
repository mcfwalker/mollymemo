// Text-to-Speech integration using OpenAI TTS API
// Converts digest scripts to audio for Telegram voice messages

export type TTSVoice =
  | 'alloy' | 'ash' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer'  // tts-1
  | 'ballad' | 'verse' | 'marin' | 'cedar'  // gpt-4o-mini-tts only

export type TTSModel = 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts'

export interface TTSOptions {
  voice?: TTSVoice
  model?: TTSModel
  speed?: number // 0.25 to 4.0, default 1.0
  instructions?: string // gpt-4o-mini-tts only: how to speak
}

const DEFAULT_OPTIONS: Required<TTSOptions> = {
  voice: 'marin',
  model: 'gpt-4o-mini-tts',
  speed: 1.0,
  instructions: 'Young, ambitious assistant. Sharp and decisive, loves her job. Friendly but gets down to business. Confident, clear, no filler.',
}

export async function textToSpeech(
  text: string,
  options: TTSOptions = {}
): Promise<{ audio: Buffer; cost: number }> {
  const { voice, model, speed, instructions } = { ...DEFAULT_OPTIONS, ...options }

  const body: Record<string, unknown> = {
    model,
    voice,
    input: text,
    response_format: 'opus', // Telegram-native format
    speed,
  }

  // gpt-4o-mini-tts supports instructions for how to speak
  if (model === 'gpt-4o-mini-tts' && instructions) {
    body.instructions = instructions
  }

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI TTS error: ${response.status} - ${error}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const cost = estimateTTSCost(text)
  return { audio: Buffer.from(arrayBuffer), cost }
}

// Calculate approximate cost for TTS
// OpenAI TTS pricing: $0.015 per 1K characters (tts-1)
export function estimateTTSCost(text: string): number {
  const characters = text.length
  return (characters / 1000) * 0.015
}
