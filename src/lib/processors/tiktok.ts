// TikTok processor using OpenAI for transcription

import { extractGitHubUrls } from './detect'
import { extractReposFromTranscript } from './repo-extractor'
import logger from '@/lib/logger'

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
      logger.error({ status: response.status }, 'tikwm API error')
      return null
    }

    const data = await response.json()
    const videoUrl = data?.data?.play || data?.data?.hdplay || data?.data?.wmplay

    if (!videoUrl) {
      logger.error({ response: data }, 'No video URL in tikwm response')
      return null
    }

    return {
      videoUrl,
      title: data?.data?.title || null,
      author: data?.data?.author?.nickname || null,
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting TikTok metadata')
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
      logger.error({ status: videoResponse.status, statusText: videoResponse.statusText }, 'Failed to download video')
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
      logger.error({ status: response.status, body: error }, 'OpenAI transcription error')
      return null
    }

    const data = await response.json()
    // Return empty string (not null) when no speech detected
    return data.text ?? ''
  } catch (error) {
    logger.error({ err: error }, 'Transcription error')
    return null
  }
}

export async function processTikTok(url: string): Promise<TikTokResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    logger.error('OPENAI_API_KEY not configured')
    return null
  }

  try {
    // Step 1: Get video URL and metadata from TikTok
    const metadata = await getTikTokMetadata(url)
    if (!metadata) {
      logger.error('Could not get TikTok metadata')
      return null
    }

    // Step 2: Transcribe with OpenAI
    const transcriptResult = await transcribeWithOpenAI(metadata.videoUrl, apiKey)
    if (transcriptResult === null) {
      logger.error('Transcription failed')
      return null
    }

    // Step 3: Use transcript if available, otherwise fall back to caption
    let transcript = transcriptResult
    let usingCaptionFallback = false
    if (!transcript && metadata.title) {
      logger.info('No speech detected, using TikTok caption as fallback')
      transcript = `[Caption]: ${metadata.title}`
      usingCaptionFallback = true
    }

    if (!transcript) {
      logger.error('No transcript or caption available')
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
    logger.error({ err: error }, 'TikTok processing error')
    return null
  }
}
