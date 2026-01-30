// TikTok processor using OpenAI for transcription

import { extractReposFromTranscript } from './repo-extractor'

interface TikTokResult {
  transcript: string
  extractedUrls: string[]
  repoExtractionCost: number
}

// Get direct video URL from TikTok using tikwm API
async function getTikTokVideoUrl(tiktokUrl: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.tikwm.com/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(tiktokUrl)}`,
    })

    if (!response.ok) {
      console.error('tikwm API error:', response.status)
      return null
    }

    const data = await response.json()
    const videoUrl = data?.data?.play || data?.data?.hdplay || data?.data?.wmplay

    if (!videoUrl) {
      console.error('No video URL in tikwm response:', JSON.stringify(data))
      return null
    }

    return videoUrl
  } catch (error) {
    console.error('Error getting TikTok video URL:', error)
    return null
  }
}

// Transcribe video using OpenAI's GPT-4o Mini Transcribe
async function transcribeWithOpenAI(
  videoUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    console.log('[DEBUG] Starting transcription, video URL:', videoUrl.substring(0, 100))

    // Download video first (OpenAI requires file upload)
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) {
      console.error('[DEBUG] Failed to download video:', videoResponse.status, videoResponse.statusText)
      return null
    }

    const videoBlob = await videoResponse.blob()
    console.log('[DEBUG] Video downloaded, size:', videoBlob.size, 'type:', videoBlob.type)

    const formData = new FormData()
    formData.append('file', videoBlob, 'video.mp4')
    formData.append('model', 'gpt-4o-mini-transcribe')

    console.log('[DEBUG] Calling OpenAI transcription API...')
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    })

    console.log('[DEBUG] OpenAI response status:', response.status)

    if (!response.ok) {
      const error = await response.text()
      console.error('[DEBUG] OpenAI transcription error:', response.status, error)
      return null
    }

    const data = await response.json()
    console.log('[DEBUG] OpenAI response data:', JSON.stringify(data).substring(0, 200))
    return data.text || null
  } catch (error) {
    console.error('[DEBUG] Transcription error:', error)
    return null
  }
}

export async function processTikTok(url: string): Promise<TikTokResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured')
    return null
  }

  try {
    // Step 1: Get direct video URL from TikTok
    const videoUrl = await getTikTokVideoUrl(url)
    if (!videoUrl) {
      console.error('Could not get TikTok video URL')
      return null
    }

    // Step 2: Transcribe with OpenAI
    const transcript = await transcribeWithOpenAI(videoUrl, apiKey)
    if (!transcript) {
      console.error('Transcription failed')
      return null
    }

    // Step 3: Extract explicit GitHub URLs from transcript
    const githubUrlPattern = /github\.com\/[^\s"'<>,.]+/gi
    const urlMatches = transcript.match(githubUrlPattern) || []
    const explicitUrls = [...new Set(urlMatches.map((m: string) =>
      `https://${m.replace(/[.,;:!?)]+$/, '')}` // Clean trailing punctuation
    ))]

    // Step 4: If no explicit URLs, use smart extraction
    let extractedUrls = explicitUrls
    let repoExtractionCost = 0
    if (explicitUrls.length === 0) {
      const { repos, cost } = await extractReposFromTranscript(transcript)
      extractedUrls = repos.map(r => r.url)
      repoExtractionCost = cost
    }

    return {
      transcript,
      extractedUrls,
      repoExtractionCost,
    }
  } catch (error) {
    console.error('TikTok processing error:', error)
    return null
  }
}
