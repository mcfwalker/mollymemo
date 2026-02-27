// TikTok processor using OpenAI for transcription

import { extractGitHubUrls } from './detect'
import { extractReposFromTranscript } from './repo-extractor'

interface TikTokResult {
  transcript: string
  extractedUrls: string[]
  repoExtractionCost: number
}

interface TikTokMetadata {
  videoUrl: string
  title: string | null
  author: string | null
}

// Get video URL and metadata from TikTok using tikwm API
async function getTikTokMetadata(tiktokUrl: string): Promise<TikTokMetadata | null> {
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

    return {
      videoUrl,
      title: data?.data?.title || null,
      author: data?.data?.author?.nickname || null,
    }
  } catch (error) {
    console.error('Error getting TikTok metadata:', error)
    return null
  }
}

// Transcribe video using OpenAI's GPT-4o Mini Transcribe
// Returns empty string if no speech detected, null on error
async function transcribeWithOpenAI(
  videoUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    // Download video first (OpenAI requires file upload)
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) {
      console.error('Failed to download video:', videoResponse.status, videoResponse.statusText)
      return null
    }

    const videoBlob = await videoResponse.blob()

    const formData = new FormData()
    formData.append('file', videoBlob, 'video.mp4')
    formData.append('model', 'gpt-4o-mini-transcribe')

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OpenAI transcription error:', response.status, error)
      return null
    }

    const data = await response.json()
    // Return empty string (not null) when no speech detected
    return data.text ?? ''
  } catch (error) {
    console.error('Transcription error:', error)
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
    // Step 1: Get video URL and metadata from TikTok
    const metadata = await getTikTokMetadata(url)
    if (!metadata) {
      console.error('Could not get TikTok metadata')
      return null
    }

    // Step 2: Transcribe with OpenAI
    const transcriptResult = await transcribeWithOpenAI(metadata.videoUrl, apiKey)
    if (transcriptResult === null) {
      console.error('Transcription failed')
      return null
    }

    // Step 3: Use transcript if available, otherwise fall back to caption
    let transcript = transcriptResult
    let usingCaptionFallback = false
    if (!transcript && metadata.title) {
      console.log('No speech detected, using TikTok caption as fallback')
      transcript = `[Caption]: ${metadata.title}`
      usingCaptionFallback = true
    }

    if (!transcript) {
      console.error('No transcript or caption available')
      return null
    }

    // Step 4: Extract explicit GitHub URLs from transcript
    const explicitUrls = extractGitHubUrls(transcript)

    // Step 5: If no explicit URLs, use smart extraction (skip for caption-only to avoid hallucinations)
    let extractedUrls = explicitUrls
    let repoExtractionCost = 0
    if (explicitUrls.length === 0 && !usingCaptionFallback) {
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
