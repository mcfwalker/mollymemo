// YouTube processor - extracts transcripts and metadata from YouTube videos

import { extractGitHubUrls } from './detect'
import { extractReposFromTranscript } from './repo-extractor'
import logger from '@/lib/logger'

interface YouTubeResult {
  transcript: string
  extractedUrls: string[]
  repoExtractionCost: number
}

// YouTube's public InnerTube API key (same key embedded in every YouTube page — not a private credential)
const INNERTUBE_API_KEY = process.env.YOUTUBE_INNERTUBE_KEY || ''
const INNERTUBE_API_URL = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`

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
 * Decode HTML entities in caption text.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '') // strip nested HTML tags
}

/**
 * Fetch transcript via YouTube InnerTube API (ANDROID client).
 * Returns joined caption text, or null if unavailable.
 *
 * Uses the ANDROID client because the WEB client often omits caption
 * tracks. The response is srv3 XML with <p>/<s> tags.
 */
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // Step 1: Get caption tracks via InnerTube player endpoint
    const playerRes = await fetch(INNERTUBE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
    })

    if (!playerRes.ok) return null

    const playerData = await playerRes.json()
    const captionTracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks

    if (!captionTracks || captionTracks.length === 0) return null

    // Prefer English track
    const track =
      captionTracks.find(
        (t: { languageCode: string }) => t.languageCode === 'en'
      ) || captionTracks[0]

    // Step 2: Fetch caption XML
    const xmlRes = await fetch(track.baseUrl)
    if (!xmlRes.ok) return null

    const xml = await xmlRes.text()
    if (!xml) return null

    // Step 3: Parse srv3 XML format (<p> paragraphs with <s> segments)
    const paragraphs = [...xml.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/g)]

    if (paragraphs.length > 0) {
      const texts = paragraphs
        .map((p) => {
          // Extract text from <s> segments within each <p>
          const segments = [...p[1].matchAll(/<s[^>]*>([^<]*)<\/s>/g)]
          if (segments.length > 0) {
            return segments.map((s) => decodeEntities(s[1])).join('')
          }
          // Fallback: direct paragraph text
          return decodeEntities(p[1])
        })
        .map((t) => t.trim())
        .filter((t) => t)

      if (texts.length > 0) return texts.join(' ')
    }

    // Fallback: try legacy <text> format
    const textMatches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
    if (textMatches.length > 0) {
      const texts = textMatches
        .map((m) => decodeEntities(m[1]).trim())
        .filter((t) => t)
      if (texts.length > 0) return texts.join(' ')
    }

    return null
  } catch {
    return null
  }
}

export async function processYouTube(url: string): Promise<YouTubeResult | null> {
  const videoId = parseYouTubeVideoId(url)
  if (!videoId) {
    logger.error({ url }, 'Could not parse YouTube video ID from URL')
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
      logger.info('No transcript available, using oEmbed metadata as fallback')
      fullTranscript = `[Title]: ${metadata.title}\n[Author]: ${metadata.authorName}`
    }

    if (!fullTranscript) {
      logger.error({ videoId }, 'No transcript or metadata available for YouTube video')
      return null
    }

    // Extract explicit GitHub URLs from transcript
    const explicitUrls = extractGitHubUrls(fullTranscript)

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
    logger.error({ err: error }, 'YouTube processing error')
    return null
  }
}
