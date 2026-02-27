import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { processYouTube, parseYouTubeVideoId } from './youtube'

// Mock repo-extractor
vi.mock('./repo-extractor', () => ({
  extractReposFromTranscript: vi.fn().mockResolvedValue({
    repos: [{ url: 'https://github.com/extracted/repo' }],
    cost: 0.001,
  }),
}))

import { extractReposFromTranscript } from './repo-extractor'

// Helper: mock InnerTube player response with caption tracks
function mockPlayerResponse(captionXml: string | null) {
  if (!captionXml) {
    // No captions available
    return {
      ok: true,
      json: () => Promise.resolve({
        captions: null,
        videoDetails: { title: 'Test Video' },
      }),
    }
  }
  return {
    ok: true,
    json: () => Promise.resolve({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=test' },
          ],
        },
      },
      videoDetails: { title: 'Test Video' },
    }),
  }
}

// Helper: mock caption XML response
function mockCaptionXml(xml: string) {
  return { ok: true, text: () => Promise.resolve(xml) }
}

// Build srv3 XML from text segments
function buildSrv3Xml(segments: string[]): string {
  const paragraphs = segments.map((text, i) =>
    `<p t="${i * 2000}" d="2000" w="1"><s ac="0">${text}</s></p>`
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>${paragraphs}</body></timedtext>`
}

describe('parseYouTubeVideoId', () => {
  it('parses standard watch URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses short URLs', () => {
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses shorts URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses live URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses embed URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('strips extra query params', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube URLs', () => {
    expect(parseYouTubeVideoId('https://vimeo.com/12345')).toBeNull()
    expect(parseYouTubeVideoId('https://example.com')).toBeNull()
  })

  it('returns null for YouTube URLs without video ID', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/')).toBeNull()
    expect(parseYouTubeVideoId('https://www.youtube.com/channel/UCxxx')).toBeNull()
  })
})

describe('processYouTube', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('processes YouTube video with transcript', async () => {
    const xml = buildSrv3Xml([
      'Hello everyone, today we look at',
      'this amazing tool on github.com/user/repo',
    ])

    global.fetch = vi.fn()
      // oEmbed metadata
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ title: 'Test Video Title', author_name: 'Test Author' }),
      })
      // InnerTube player
      .mockResolvedValueOnce(mockPlayerResponse(xml))
      // Caption XML
      .mockResolvedValueOnce(mockCaptionXml(xml))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result).not.toBeNull()
    expect(result!.transcript).toContain('Hello everyone')
    expect(result!.transcript).toContain('github.com/user/repo')
    expect(result!.extractedUrls).toContain('https://github.com/user/repo')
    expect(extractReposFromTranscript).not.toHaveBeenCalled()
  })

  it('uses smart extraction when no GitHub URLs in transcript', async () => {
    const xml = buildSrv3Xml(['This video talks about a cool tool'])

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ title: 'Test Video', author_name: 'Author' }),
      })
      .mockResolvedValueOnce(mockPlayerResponse(xml))
      .mockResolvedValueOnce(mockCaptionXml(xml))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(extractReposFromTranscript).toHaveBeenCalled()
    expect(result!.extractedUrls).toContain('https://github.com/extracted/repo')
    expect(result!.repoExtractionCost).toBe(0.001)
  })

  it('falls back to oEmbed title when transcript unavailable', async () => {
    global.fetch = vi.fn()
      // oEmbed succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ title: 'Amazing AI Tool Review', author_name: 'Tech Reviewer' }),
      })
      // InnerTube returns no captions
      .mockResolvedValueOnce(mockPlayerResponse(null))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result).not.toBeNull()
    expect(result!.transcript).toBe('[Title]: Amazing AI Tool Review\n[Author]: Tech Reviewer')
  })

  it('handles youtu.be short URLs', async () => {
    const xml = buildSrv3Xml(['Content from short URL'])

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ title: 'Short URL Video', author_name: 'Author' }),
      })
      .mockResolvedValueOnce(mockPlayerResponse(xml))
      .mockResolvedValueOnce(mockCaptionXml(xml))

    const result = await processYouTube('https://youtu.be/dQw4w9WgXcQ')
    expect(result).not.toBeNull()
    expect(result!.transcript).toContain('Content from short URL')
  })

  it('returns null for invalid YouTube URLs', async () => {
    const result = await processYouTube('https://vimeo.com/12345')
    expect(result).toBeNull()
  })

  it('returns null when oEmbed fails and no transcript', async () => {
    global.fetch = vi.fn()
      // oEmbed fails
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // InnerTube returns no captions
      .mockResolvedValueOnce(mockPlayerResponse(null))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toBeNull()
  })

  it('handles network errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toBeNull()
  })

  it('deduplicates extracted GitHub URLs', async () => {
    const xml = buildSrv3Xml(['Check github.com/user/repo and again github.com/user/repo here'])

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ title: 'Test', author_name: 'Author' }),
      })
      .mockResolvedValueOnce(mockPlayerResponse(xml))
      .mockResolvedValueOnce(mockCaptionXml(xml))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    const repoCount = result?.extractedUrls.filter(u => u === 'https://github.com/user/repo').length
    expect(repoCount).toBe(1)
  })

  it('cleans trailing punctuation from GitHub URLs', async () => {
    const xml = buildSrv3Xml(['Go to github.com/user/repo, or check github.com/org/tool.'])

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ title: 'Test', author_name: 'Author' }),
      })
      .mockResolvedValueOnce(mockPlayerResponse(xml))
      .mockResolvedValueOnce(mockCaptionXml(xml))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result?.extractedUrls).toContain('https://github.com/user/repo')
    expect(result?.extractedUrls).toContain('https://github.com/org/tool')
    expect(result?.extractedUrls).not.toContain('https://github.com/user/repo,')
    expect(result?.extractedUrls).not.toContain('https://github.com/org/tool.')
  })

  it('includes oEmbed metadata in transcript', async () => {
    const xml = buildSrv3Xml(['Transcript text here'])

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ title: 'Video Title', author_name: 'Channel Name' }),
      })
      .mockResolvedValueOnce(mockPlayerResponse(xml))
      .mockResolvedValueOnce(mockCaptionXml(xml))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result!.transcript).toContain('Video Title')
    expect(result!.transcript).toContain('Channel Name')
    expect(result!.transcript).toContain('Transcript text here')
  })
})
