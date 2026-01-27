import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchXContentWithGrok, fetchArticleWithGrok } from './grok'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('grok.ts', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, XAI_API_KEY: 'test-api-key' }
    mockFetch.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('fetchXContentWithGrok', () => {
    it('returns null when API key is not configured', async () => {
      delete process.env.XAI_API_KEY

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns null on API error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      })

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result).toBeNull()
    })

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result).toBeNull()
    })

    it('parses JSON response with all fields', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  fullText: 'This is the post content',
                  videoTranscript: 'Video transcript here',
                  authorName: '@testuser',
                  summary: 'A summary of the post',
                  mentionedRepos: ['owner/repo1', 'https://github.com/owner/repo2'],
                  mentionedTools: ['tool1'],
                }),
                annotations: [
                  { type: 'url_citation', url: 'https://example.com/source' },
                ],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result).toEqual({
        text: 'This is the post content',
        videoTranscript: 'Video transcript here',
        authorName: '@testuser',
        summary: 'A summary of the post',
        citations: [
          'https://example.com/source',
          'https://github.com/owner/repo1',
          'https://github.com/owner/repo2',
        ],
      })
    })

    it('extracts JSON from markdown-wrapped response', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '```json\n{"fullText": "Content here", "summary": "Summary"}\n```',
                annotations: [],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result?.text).toBe('Content here')
      expect(result?.summary).toBe('Summary')
    })

    it('falls back to raw content when JSON parsing fails', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'This is plain text content without JSON',
                annotations: [{ type: 'url_citation', url: 'https://cited.com' }],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result).toEqual({
        text: 'This is plain text content without JSON',
        videoTranscript: null,
        authorName: null,
        summary: 'This is plain text content without JSON',
        citations: ['https://cited.com'],
      })
    })

    it('handles empty output array', async () => {
      const grokResponse = { output: [] }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result).toEqual({
        text: '',
        videoTranscript: null,
        authorName: null,
        summary: '',
        citations: [],
      })
    })

    it('converts repo names to GitHub URLs', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  fullText: 'Content',
                  summary: 'Summary',
                  mentionedRepos: [
                    'owner/repo',
                    'https://github.com/full/url',
                    'single-name',
                  ],
                }),
                annotations: [],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(result?.citations).toContain('https://github.com/owner/repo')
      expect(result?.citations).toContain('https://github.com/full/url')
      expect(result?.citations).toContain('single-name') // Can't convert
    })

    it('deduplicates citations and repo URLs', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  fullText: 'Content',
                  summary: 'Summary',
                  mentionedRepos: ['owner/repo'],
                }),
                annotations: [
                  { type: 'url_citation', url: 'https://github.com/owner/repo' },
                ],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchXContentWithGrok('https://x.com/test/status/123')

      // Should be deduplicated
      expect(result?.citations.filter(c => c === 'https://github.com/owner/repo')).toHaveLength(1)
    })

    it('sends correct request to Grok API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: [] }),
      })

      await fetchXContentWithGrok('https://x.com/test/status/123')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/responses',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
          },
        })
      )

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.model).toBe('grok-4-1-fast')
      expect(callBody.tools).toContainEqual(
        expect.objectContaining({ type: 'x_search' })
      )
    })
  })

  describe('fetchArticleWithGrok', () => {
    it('returns null when API key is not configured', async () => {
      delete process.env.XAI_API_KEY

      const result = await fetchArticleWithGrok('https://example.com/article')

      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns null on API error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server error',
      })

      const result = await fetchArticleWithGrok('https://example.com/article')

      expect(result).toBeNull()
    })

    it('parses response and extracts content and citations', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Article summary content',
                annotations: [
                  { type: 'url_citation', url: 'https://source1.com' },
                  { type: 'url_citation', url: 'https://source2.com' },
                ],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchArticleWithGrok('https://example.com/article')

      expect(result).toEqual({
        content: 'Article summary content',
        citations: ['https://source1.com', 'https://source2.com'],
      })
    })

    it('handles response with no citations', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Article content',
                annotations: [],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchArticleWithGrok('https://example.com/article')

      expect(result).toEqual({
        content: 'Article content',
        citations: [],
      })
    })

    it('sends correct request with web_search tool', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ output: [] }),
      })

      await fetchArticleWithGrok('https://example.com/article')

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.tools).toContainEqual(
        expect.objectContaining({ type: 'web_search' })
      )
    })

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const result = await fetchArticleWithGrok('https://example.com/article')

      expect(result).toBeNull()
    })

    it('filters out non-url citations', async () => {
      const grokResponse = {
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Content',
                annotations: [
                  { type: 'url_citation', url: 'https://valid.com' },
                  { type: 'other_type', url: 'https://ignored.com' },
                  { type: 'url_citation', url: null },
                  { type: 'url_citation' }, // no url field
                ],
              },
            ],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => grokResponse,
      })

      const result = await fetchArticleWithGrok('https://example.com/article')

      expect(result?.citations).toEqual(['https://valid.com'])
    })
  })
})
