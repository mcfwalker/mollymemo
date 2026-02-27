// YouTube processor - extracts transcripts and metadata from YouTube videos

import { YoutubeTranscript } from 'youtube-transcript'
import { extractReposFromTranscript } from './repo-extractor'

interface YouTubeResult {
  transcript: string
  extractedUrls: string[]
  repoExtractionCost: number
}

/**
 * Parse a YouTube video ID from various URL formats:
 * - youtube.com/watch?v=ID
 * - youtu.be/ID
 * - youtube.com/shorts/ID
 * - youtube.com/live/ID
 * - youtube.com/embed/ID
 */
export function parseYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    // youtu.be/VIDEO_ID
    if (hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0]
      return id || null
    }

    // Must be youtube.com domain
    if (!hostname.includes('youtube.com')) return null

    // youtube.com/watch?v=VIDEO_ID
    const vParam = parsed.searchParams.get('v')
    if (vParam) return vParam

    // youtube.com/shorts/ID, /live/ID, /embed/ID
    const pathMatch = parsed.pathname.match(/^\/(shorts|live|embed)\/([^/?]+)/)
    if (pathMatch) return pathMatch[2]

    return null
  } catch {
    return null
  }
}

/**
 * Fetch video metadata via YouTube oEmbed API (no API key needed).
 * Returns title and author, or null on failure.
 */
async function fetchOEmbedMetadata(
  url: string
): Promise<{ title: string; authorName: string } | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    const response = await fetch(oembedUrl)
    if (!response.ok) return null

    const data = await response.json()
    return {
      title: data.title || 'Untitled',
      authorName: data.author_name || 'Unknown',
    }
  } catch {
    return null
  }
}

/**
 * Fetch transcript captions via youtube-transcript package.
 * Returns joined text, or null if captions unavailable.
 */
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    if (!segments || segments.length === 0) return null
    return segments.map((s) => s.text).join(' ')
  } catch {
    return null
  }
}

export async function processYouTube(url: string): Promise<YouTubeResult | null> {
  const videoId = parseYouTubeVideoId(url)
  if (!videoId) {
    console.error('Could not parse YouTube video ID from URL:', url)
    return null
  }

  try {
    // Fetch metadata and transcript in parallel
    const [metadata, transcript] = await Promise.all([
      fetchOEmbedMetadata(url),
      fetchTranscript(videoId),
    ])

    // Build the full transcript string
    let fullTranscript: string | null = null

    if (transcript) {
      // Include metadata header for classifier context
      const header = metadata
        ? `[Title]: ${metadata.title}\n[Author]: ${metadata.authorName}\n\n`
        : ''
      fullTranscript = `${header}[Transcript]: ${transcript}`
    } else if (metadata) {
      // Fallback: use title/author when no captions
      console.log('No transcript available, using oEmbed metadata as fallback')
      fullTranscript = `[Title]: ${metadata.title}\n[Author]: ${metadata.authorName}`
    }

    if (!fullTranscript) {
      console.error('No transcript or metadata available for YouTube video:', videoId)
      return null
    }

    // Extract explicit GitHub URLs from transcript
    const githubUrlPattern = /github\.com\/[^\s"'<>,.]+/gi
    const urlMatches = fullTranscript.match(githubUrlPattern) || []
    const explicitUrls = [
      ...new Set(
        urlMatches.map(
          (m: string) => `https://${m.replace(/[.,;:!?)]+$/, '')}`
        )
      ),
    ]

    // Smart extraction if no explicit GitHub URLs found (skip for metadata-only fallback)
    let extractedUrls = explicitUrls
    let repoExtractionCost = 0
    if (explicitUrls.length === 0 && transcript) {
      const { repos, cost } = await extractReposFromTranscript(fullTranscript)
      extractedUrls = repos.map((r) => r.url)
      repoExtractionCost = cost
    }

    return {
      transcript: fullTranscript,
      extractedUrls,
      repoExtractionCost,
    }
  } catch (error) {
    console.error('YouTube processing error:', error)
    return null
  }
}
