import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processArticle, tryRewriteArxivUrl } from './article'

// Mock pdf-parse at module level
vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}))

describe('processArticle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts article content from HTML', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Article Title</title>
          <meta property="article:published_time" content="2026-01-27T10:00:00Z">
          <meta property="og:site_name" content="Test Site">
        </head>
        <body>
          <article>
            <h1>Test Article Title</h1>
            <p class="byline">By Test Author</p>
            <p>This is the main content of the article. It contains enough text to be parsed by Readability. The article discusses important topics and provides valuable information to readers.</p>
            <p>Additional paragraph with more content to ensure the article is long enough for extraction.</p>
          </article>
        </body>
      </html>
    `

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: () => Promise.resolve(mockHtml),
    } as Response)

    const result = await processArticle('https://example.com/article')

    expect(result).not.toBeNull()
    expect(result?.title).toBe('Test Article Title')
    expect(result?.content).toContain('main content of the article')
    expect(result?.publishedTime).toBe('2026-01-27T10:00:00Z')
  })

  it('returns null for failed fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
    } as Response)

    const result = await processArticle('https://example.com/not-found')

    expect(result).toBeNull()
  })

  it('returns null for unparseable content', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve('<html><body></body></html>'),
    } as Response)

    const result = await processArticle('https://example.com/empty')

    expect(result).toBeNull()
  })

  it('extracts published time from various meta tags', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Article with pubdate</title>
          <meta name="pubdate" content="2026-01-15T08:30:00Z">
        </head>
        <body>
          <article>
            <h1>Article with pubdate</h1>
            <p>Content that is long enough to be extracted by Readability parser for testing purposes.</p>
          </article>
        </body>
      </html>
    `

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve(mockHtml),
    } as Response)

    const result = await processArticle('https://example.com/article')

    expect(result?.publishedTime).toBe('2026-01-15T08:30:00Z')
  })

  it('handles network errors gracefully', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'))

    const result = await processArticle('https://example.com/error')

    expect(result).toBeNull()
  })

  // --- PDF-specific tests ---

  it('extracts text from PDF via pdf-parse when Content-Type is application/pdf', async () => {
    const pdfParse = (await import('pdf-parse')).default as ReturnType<typeof vi.fn>
    pdfParse.mockResolvedValueOnce({
      text: 'Extracted PDF content here with enough text to test.',
      info: { Title: 'My PDF Paper', Author: 'Jane Doe' },
    })

    const fakeBuffer = new ArrayBuffer(8)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(fakeBuffer),
    } as Response)

    const result = await processArticle('https://example.com/paper.pdf')

    expect(result).not.toBeNull()
    expect(result?.title).toBe('My PDF Paper')
    expect(result?.byline).toBe('Jane Doe')
    expect(result?.content).toBe('Extracted PDF content here with enough text to test.')
    expect(result?.siteName).toBe('example.com')
  })

  it('rewrites arxiv PDF URL to abs page and parses HTML', async () => {
    const absHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Paper Title - arxiv</title></head>
        <body>
          <article>
            <h1>Paper Title</h1>
            <p>This is the abstract of the paper. It describes a novel approach to solving an important problem in machine learning.</p>
            <p>Additional content from the arxiv abstract page with enough text for Readability to work properly.</p>
          </article>
        </body>
      </html>
    `

    const fetchSpy = vi.spyOn(global, 'fetch')
    // First call: PDF response from arxiv
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
    } as Response)
    // Second call: abs page HTML
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(absHtml),
    } as Response)

    const result = await processArticle('https://arxiv.org/pdf/2301.07041')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1][0]).toBe('https://arxiv.org/abs/2301.07041')
    expect(result).not.toBeNull()
    expect(result?.content).toContain('abstract of the paper')
  })

  it('rewrites arxiv PDF URL with version suffix', async () => {
    const absHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Versioned Paper</title></head>
        <body>
          <article>
            <h1>Versioned Paper</h1>
            <p>This paper has been revised multiple times. This is version two of the manuscript with updated results.</p>
            <p>More content for Readability to have enough text to parse this document properly.</p>
          </article>
        </body>
      </html>
    `

    const fetchSpy = vi.spyOn(global, 'fetch')
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
    } as Response)
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(absHtml),
    } as Response)

    const result = await processArticle('https://arxiv.org/pdf/2301.07041v2')

    expect(fetchSpy.mock.calls[1][0]).toBe('https://arxiv.org/abs/2301.07041v2')
    expect(result).not.toBeNull()
    expect(result?.content).toContain('version two')
  })

  it('returns null when PDF has empty text', async () => {
    const pdfParse = (await import('pdf-parse')).default as ReturnType<typeof vi.fn>
    pdfParse.mockResolvedValueOnce({
      text: '   ',
      info: {},
    })

    const fakeBuffer = new ArrayBuffer(8)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(fakeBuffer),
    } as Response)

    const result = await processArticle('https://example.com/empty.pdf')

    expect(result).toBeNull()
  })

  it('rewrites alphaxiv.org HTML to arxiv.org for extraction', async () => {
    const arxivHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Evaluating AGENTS.md - arxiv</title></head>
        <body>
          <article>
            <h1>Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?</h1>
            <p>We evaluate whether repository-level context files like AGENTS.md improve the performance of coding agents on real-world tasks.</p>
            <p>Our findings show significant improvements in agent task completion when these files are present.</p>
          </article>
        </body>
      </html>
    `

    const fetchSpy = vi.spyOn(global, 'fetch')
    // First call: alphaxiv HTML page
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: () => Promise.resolve('<html><body>alphaxiv page</body></html>'),
    } as Response)
    // Second call: rewritten to arxiv.org abs page
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(arxivHtml),
    } as Response)

    const result = await processArticle('https://www.alphaxiv.org/abs/2602.11988')

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1][0]).toBe('https://arxiv.org/abs/2602.11988')
    expect(result).not.toBeNull()
    expect(result?.content).toContain('repository-level context files')
  })

  it('uses HTML/Readability path when Content-Type is not PDF', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Regular Page</title></head>
        <body>
          <article>
            <h1>Regular Page</h1>
            <p>This is a normal HTML page that should go through the standard Readability extraction path.</p>
            <p>More content to ensure Readability has enough text to parse this document successfully.</p>
          </article>
        </body>
      </html>
    `

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: () => Promise.resolve(mockHtml),
    } as Response)

    const result = await processArticle('https://example.com/page')

    expect(result).not.toBeNull()
    expect(result?.content).toContain('normal HTML page')
  })
})

describe('tryRewriteArxivUrl', () => {
  it('rewrites /pdf/ to /abs/', () => {
    expect(tryRewriteArxivUrl('https://arxiv.org/pdf/2301.07041')).toBe(
      'https://arxiv.org/abs/2301.07041'
    )
  })

  it('strips .pdf suffix', () => {
    expect(tryRewriteArxivUrl('https://arxiv.org/pdf/2301.07041.pdf')).toBe(
      'https://arxiv.org/abs/2301.07041'
    )
  })

  it('preserves version suffix', () => {
    expect(tryRewriteArxivUrl('https://arxiv.org/pdf/2301.07041v2')).toBe(
      'https://arxiv.org/abs/2301.07041v2'
    )
  })

  it('returns null for non-arxiv URLs', () => {
    expect(tryRewriteArxivUrl('https://example.com/pdf/123')).toBeNull()
  })

  it('returns null for non-PDF arxiv paths', () => {
    expect(tryRewriteArxivUrl('https://arxiv.org/abs/2301.07041')).toBeNull()
  })

  it('rewrites alphaxiv.org /abs/ to arxiv.org /abs/', () => {
    expect(tryRewriteArxivUrl('https://www.alphaxiv.org/abs/2602.11988')).toBe(
      'https://arxiv.org/abs/2602.11988'
    )
  })

  it('rewrites alphaxiv.org /pdf/ to arxiv.org /abs/', () => {
    expect(tryRewriteArxivUrl('https://alphaxiv.org/pdf/2602.11988')).toBe(
      'https://arxiv.org/abs/2602.11988'
    )
  })

  it('rewrites alphaxiv.org with .pdf suffix', () => {
    expect(tryRewriteArxivUrl('https://alphaxiv.org/pdf/2602.11988.pdf')).toBe(
      'https://arxiv.org/abs/2602.11988'
    )
  })
})
