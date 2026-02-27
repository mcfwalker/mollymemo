import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { processYouTube, parseYouTubeVideoId } from './youtube'

// Mock youtube-transcript
vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}))

// Mock repo-extractor
vi.mock('./repo-extractor', () => ({
  extractReposFromTranscript: vi.fn().mockResolvedValue({
    repos: [{ url: 'https://github.com/extracted/repo' }],
    cost: 0.001,
  }),
}))

import { YoutubeTranscript } from 'youtube-transcript'
import { extractReposFromTranscript } from './repo-extractor'

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
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Test Video Title',
        author_name: 'Test Author',
        author_url: 'https://www.youtube.com/@testauthor',
      }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Hello everyone, today we look at', duration: 5, offset: 0, lang: 'en' },
      { text: 'this amazing tool on github.com/user/repo', duration: 5, offset: 5, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result).not.toBeNull()
    expect(result!.transcript).toContain('Hello everyone')
    expect(result!.transcript).toContain('github.com/user/repo')
    expect(result!.extractedUrls).toContain('https://github.com/user/repo')
    expect(extractReposFromTranscript).not.toHaveBeenCalled()
  })

  it('uses smart extraction when no GitHub URLs in transcript', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Test Video',
        author_name: 'Author',
      }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'This video talks about a cool tool', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(extractReposFromTranscript).toHaveBeenCalled()
    expect(result!.extractedUrls).toContain('https://github.com/extracted/repo')
    expect(result!.repoExtractionCost).toBe(0.001)
  })

  it('falls back to oEmbed title when transcript unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Amazing AI Tool Review',
        author_name: 'Tech Reviewer',
      }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(
      new Error('Transcript is disabled')
    )

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result).not.toBeNull()
    expect(result!.transcript).toBe('[Title]: Amazing AI Tool Review\n[Author]: Tech Reviewer')
  })

  it('handles youtu.be short URLs', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ title: 'Short URL Video', author_name: 'Author' }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Content from short URL', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://youtu.be/dQw4w9WgXcQ')
    expect(result).not.toBeNull()
    expect(result!.transcript).toContain('Content from short URL')
  })

  it('returns null for invalid YouTube URLs', async () => {
    const result = await processYouTube('https://vimeo.com/12345')
    expect(result).toBeNull()
  })

  it('returns null when oEmbed fails and no transcript', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(
      new Error('Transcript is disabled')
    )

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toBeNull()
  })

  it('handles network errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('Network error'))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toBeNull()
  })

  it('deduplicates extracted GitHub URLs', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ title: 'Test', author_name: 'Author' }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Check github.com/user/repo and again github.com/user/repo here', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    const repoCount = result?.extractedUrls.filter(u => u === 'https://github.com/user/repo').length
    expect(repoCount).toBe(1)
  })

  it('cleans trailing punctuation from GitHub URLs', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ title: 'Test', author_name: 'Author' }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Go to github.com/user/repo, or check github.com/org/tool.', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result?.extractedUrls).toContain('https://github.com/user/repo')
    expect(result?.extractedUrls).toContain('https://github.com/org/tool')
    expect(result?.extractedUrls).not.toContain('https://github.com/user/repo,')
    expect(result?.extractedUrls).not.toContain('https://github.com/org/tool.')
  })

  it('includes oEmbed metadata in transcript', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Video Title',
        author_name: 'Channel Name',
      }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Transcript text here', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result!.transcript).toContain('Video Title')
    expect(result!.transcript).toContain('Channel Name')
    expect(result!.transcript).toContain('Transcript text here')
  })
})
