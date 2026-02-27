// X/Twitter processor - uses Grok API for full content, falls back to oembed

import { fetchXContentWithGrok } from './grok'
import logger from '@/lib/logger'

interface XMetadata {
  text: string
  videoTranscript: string | null
  authorName: string
  authorUrl: string
  resolvedUrls: string[]
  isLinkOnly: boolean
  xArticleUrl: string | null
  // Grok-enhanced fields
  summary: string | null
  grokCitations: string[]
  usedGrok: boolean
  grokCost: number
}

// Fallback: oembed API (limited but no auth required)
async function processXWithOembed(url: string): Promise<XMetadata | null> {
  try {
    const normalizedUrl = url.replace('twitter.com', 'x.com')
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}&omit_script=true`

    const response = await fetch(oembedUrl)

    if (!response.ok) {
      logger.error({ status: response.status }, 'X oembed error')
      return null
    }

    const data = await response.json()

    // Extract text from HTML (oembed returns HTML blockquote)
    const htmlText = data.html as string

    // Extract the tweet text from the <p> tag, stripping all HTML tags
    const pMatch = htmlText.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    let text = ''
    if (pMatch) {
      text = pMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim()
    }

    // Extract and resolve t.co URLs
    const tcoUrls = htmlText.match(/https:\/\/t\.co\/[a-zA-Z0-9]+/g) || []
    const resolvedUrls: string[] = []

    for (const tcoUrl of tcoUrls.slice(0, 5)) {
      try {
        const res = await fetch(tcoUrl, { redirect: 'manual' })
        const location = res.headers.get('location')
        if (location && !location.includes('t.co')) {
          resolvedUrls.push(location)
        }
      } catch {
        // Ignore failed redirects
      }
    }

    const textWithoutUrls = text.replace(/https?:\/\/\S+/g, '').trim()
    const isLinkOnly = textWithoutUrls.length < 10
    const xArticleUrl = resolvedUrls.find(u => u.includes('x.com/i/article/')) || null

    return {
      text,
      videoTranscript: null,
      authorName: data.author_name,
      authorUrl: data.author_url,
      resolvedUrls,
      isLinkOnly,
      xArticleUrl,
      summary: null,
      grokCitations: [],
      usedGrok: false,
      grokCost: 0,
    }
  } catch (error) {
    logger.error({ err: error }, 'X oembed error')
    return null
  }
}

// Primary: Use Grok API for full content access
async function processXWithGrok(url: string): Promise<XMetadata | null> {
  const grokResult = await fetchXContentWithGrok(url)

  if (!grokResult) {
    return null
  }

  // Extract GitHub URLs from citations
  const githubUrls = grokResult.citations.filter(c => c.includes('github.com'))

  return {
    text: grokResult.text,
    videoTranscript: grokResult.videoTranscript,
    authorName: grokResult.authorName || 'Unknown',
    authorUrl: '',
    resolvedUrls: githubUrls,
    isLinkOnly: false,
    xArticleUrl: null, // Grok can access X Articles directly
    summary: grokResult.summary,
    grokCitations: grokResult.citations,
    usedGrok: true,
    grokCost: grokResult.cost,
  }
}

export async function processX(url: string): Promise<XMetadata | null> {
  // Try Grok first (if API key is configured)
  if (process.env.XAI_API_KEY) {
    logger.info({ url }, 'Processing X content with Grok API')
    const grokResult = await processXWithGrok(url)
    if (grokResult) {
      logger.info({
        textLength: grokResult.text?.length,
        authorName: grokResult.authorName,
        summaryPreview: grokResult.summary?.slice(0, 100),
        usedGrok: grokResult.usedGrok
      }, 'Grok succeeded')
      return grokResult
    }
    logger.info('Grok API failed, falling back to oembed')
  } else {
    logger.info('XAI_API_KEY not configured, using oembed')
  }

  // Fallback to oembed
  const oembedResult = await processXWithOembed(url)
  logger.info({
    textLength: oembedResult?.text?.length,
    authorName: oembedResult?.authorName,
    isLinkOnly: oembedResult?.isLinkOnly
  }, 'Oembed result')
  return oembedResult
}
