import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classify } from './classifier'

describe('classifier', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    process.env.OPENAI_API_KEY = 'test-api-key'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    vi.restoreAllMocks()
  })

  it('returns null when no content is provided (prevents hallucination)', async () => {
    const result = await classify({
      sourceType: 'article',
    })

    expect(result).toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      'Classifier skipped: no transcript, metadata, or page content provided'
    )
  })

  it('returns null when only sourceUrl is provided without content', async () => {
    const result = await classify({
      sourceType: 'article',
      sourceUrl: 'https://example.com/article',
    })

    expect(result).toBeNull()
  })

  it('includes sourceUrl in prompt when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Test',
                  summary: 'Test',
                  domain: 'vibe-coding',
                  content_type: 'resource',
                  tags: ['test'],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
    })

    await classify({
      sourceType: 'article',
      sourceUrl: 'https://example.com/paper',
      transcript: 'Some article content here',
    })

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    )
    expect(callBody.messages[0].content).toContain('https://example.com/paper')
  })

  it('returns null when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY

    const result = await classify({
      sourceType: 'github',
      githubMetadata: { name: 'test', description: 'test', topics: [] },
    })

    expect(result).toBeNull()
  })

  it('calls OpenAI API with correct parameters', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Test Repo',
                  summary: 'A test repository',
                  domain: 'vibe-coding',
                  content_type: 'repo',
                  tags: ['test', 'vitest'],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
    })

    await classify({
      sourceType: 'github',
      githubMetadata: { name: 'test-repo', description: 'Test', topics: ['testing'] },
    })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
      })
    )
  })

  it('returns classification result on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Cool Tool',
                  summary: 'A useful tool for developers',
                  domain: 'vibe-coding',
                  content_type: 'tool',
                  tags: ['cli', 'productivity'],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 100 },
        }),
    })

    const result = await classify({
      sourceType: 'tiktok',
      transcript: 'This video talks about a cool tool...',
    })

    expect(result).toEqual({
      title: 'Cool Tool',
      summary: 'A useful tool for developers',
      domain: 'vibe-coding',
      content_type: 'tool',
      tags: ['cli', 'productivity'],
      cost: expect.any(Number),
    })
  })

  it('calculates cost from token usage', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Test',
                  summary: 'Test',
                  domain: 'vibe-coding',
                  content_type: 'repo',
                  tags: [],
                }),
              },
            },
          ],
          // 1000 input tokens @ $0.15/1M = $0.00015
          // 500 output tokens @ $0.60/1M = $0.0003
          // Total = $0.00045
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        }),
    })

    const result = await classify({
      sourceType: 'article',
      pageContent: 'Article content here',
    })

    expect(result?.cost).toBeCloseTo(0.00045, 6)
  })

  it('handles markdown-wrapped JSON in response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: '```json\n{"title":"Test","summary":"Test","domain":"vibe-coding","content_type":"repo","tags":[]}\n```',
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
    })

    const result = await classify({
      sourceType: 'github',
      githubMetadata: { name: 'test', description: 'test', topics: [] },
    })

    expect(result?.title).toBe('Test')
  })

  it('returns null on API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })

    const result = await classify({
      sourceType: 'github',
      githubMetadata: { name: 'test', description: 'test', topics: [] },
    })

    expect(result).toBeNull()
  })

  it('returns null when no response from API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [],
          usage: {},
        }),
    })

    const result = await classify({
      sourceType: 'github',
      githubMetadata: { name: 'test', description: 'test', topics: [] },
    })

    expect(result).toBeNull()
  })

  it('returns null on JSON parse error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: 'This is not valid JSON',
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
    })

    const result = await classify({
      sourceType: 'github',
      githubMetadata: { name: 'test', description: 'test', topics: [] },
    })

    expect(result).toBeNull()
  })

  it('falls back to default domain for invalid domain', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Test',
                  summary: 'Test',
                  domain: 'invalid-domain-that-does-not-exist',
                  content_type: 'repo',
                  tags: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
    })

    const result = await classify({
      sourceType: 'github',
      githubMetadata: { name: 'test', description: 'test', topics: [] },
    })

    expect(result?.domain).toBe('other')
  })

  it('truncates long transcripts to 3000 chars', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Test',
                  summary: 'Test',
                  domain: 'vibe-coding',
                  content_type: 'technique',
                  tags: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
    })

    const longTranscript = 'a'.repeat(5000)
    await classify({
      sourceType: 'tiktok',
      transcript: longTranscript,
    })

    const callBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    )
    // The transcript in the prompt should be truncated
    expect(callBody.messages[0].content).not.toContain('a'.repeat(5000))
    expect(callBody.messages[0].content.length).toBeLessThan(longTranscript.length + 1000)
  })
})
