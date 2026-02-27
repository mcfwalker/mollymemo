// Article processor - extracts readable content from generic URLs

import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

export interface ArticleMetadata {
  title: string | null
  content: string | null
  excerpt: string | null
  byline: string | null
  siteName: string | null
  publishedTime: string | null
}

function isPdfContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('application/pdf') ?? false
}

/**
 * Rewrites arxiv/alphaxiv URLs to the canonical arxiv.org HTML abstract page.
 * - https://arxiv.org/pdf/2301.07041v2 → https://arxiv.org/abs/2301.07041v2
 * - https://www.alphaxiv.org/abs/2602.11988 → https://arxiv.org/abs/2602.11988
 */
export function tryRewriteArxivUrl(url: string): string | null {
  const parsed = new URL(url)

  // alphaxiv.org is a discussion layer on top of arxiv — rewrite to arxiv.org
  if (parsed.hostname.endsWith('alphaxiv.org')) {
    const match = parsed.pathname.match(/^\/(abs|pdf)\/(.+?)(?:\.pdf)?$/)
    if (!match) return null
    return `https://arxiv.org/abs/${match[2]}`
  }

  if (!parsed.hostname.endsWith('arxiv.org')) return null

  // Match /pdf/ID or /pdf/ID.pdf, with optional version suffix like v2
  const match = parsed.pathname.match(/^\/pdf\/(.+?)(?:\.pdf)?$/)
  if (!match) return null

  parsed.pathname = `/abs/${match[1]}`
  return parsed.toString()
}

function extractFromHtml(url: string, html: string): ArticleMetadata | null {
  const dom = new JSDOM(html, { url })
  const document = dom.window.document

  // Extract published time from meta tags before Readability modifies DOM
  const publishedTime =
    document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
    document.querySelector('meta[name="pubdate"]')?.getAttribute('content') ||
    document.querySelector('meta[name="publishdate"]')?.getAttribute('content') ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    null

  const reader = new Readability(document)
  const article = reader.parse()

  if (!article) {
    console.error('Readability failed to parse article')
    return null
  }

  // Clean extracted text: trim and collapse runs of 3+ newlines to 2
  const content = article.textContent?.replace(/\n{3,}/g, '\n\n').trim() || null

  return {
    title: article.title ?? null,
    content,
    excerpt: article.excerpt ?? null,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    publishedTime,
  }
}

async function extractPdfText(buffer: Buffer, url: string): Promise<ArticleMetadata | null> {
  const pdfParse = (await import('pdf-parse')).default
  const data = await pdfParse(buffer)

  const text = data.text?.trim()
  if (!text) return null

  // Use first 200 chars as excerpt
  const excerpt = text.length > 200 ? text.slice(0, 200) + '...' : text

  return {
    title: data.info?.Title || null,
    content: text,
    excerpt,
    byline: data.info?.Author || null,
    siteName: new URL(url).hostname,
    publishedTime: null,
  }
}

export async function processArticle(url: string): Promise<ArticleMetadata | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MollyMemo/0.1; +https://mollymemo.com)',
        Accept: 'text/html,application/xhtml+xml,application/pdf',
      },
    })

    if (!response.ok) {
      console.error(`Article fetch error: ${response.status}`)
      return null
    }

    const contentType = response.headers.get('content-type')

    if (isPdfContentType(contentType)) {
      // Try arxiv rewrite first — their abs page has richer metadata
      const absUrl = tryRewriteArxivUrl(url)
      if (absUrl) {
        const absResponse = await fetch(absUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MollyMemo/0.1; +https://mollymemo.com)',
            Accept: 'text/html,application/xhtml+xml',
          },
        })
        if (absResponse.ok) {
          const html = await absResponse.text()
          return extractFromHtml(absUrl, html)
        }
      }

      // Generic PDF — extract text with pdf-parse
      const buffer = Buffer.from(await response.arrayBuffer())
      return await extractPdfText(buffer, url)
    }

    // For alphaxiv HTML pages, try the arxiv rewrite for better content
    const absUrl = tryRewriteArxivUrl(url)
    if (absUrl) {
      const absResponse = await fetch(absUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MollyMemo/0.1; +https://mollymemo.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
      })
      if (absResponse.ok) {
        const absHtml = await absResponse.text()
        return extractFromHtml(absUrl, absHtml)
      }
    }

    // Standard HTML path
    const html = await response.text()
    return extractFromHtml(url, html)
  } catch (error) {
    console.error('Article processing error:', error)
    return null
  }
}
