import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('suggestMerges', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    process.env.OPENAI_API_KEY = 'test-api-key'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    vi.restoreAllMocks()
  })

  it('returns merge suggestions for overlapping containers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              merges: [
                { source: 'id-2', target: 'id-1', reason: 'Both cover AI development tools' }
              ]
            })
          }
        }],
        usage: { prompt_tokens: 200, completion_tokens: 50 }
      })
    })

    const { suggestMerges } = await import('./containers')

    const containers = [
      { id: 'id-1', name: 'AI Dev Tools', description: 'Tools for AI development', item_count: 8, items: ['Item A', 'Item B'] },
      { id: 'id-2', name: 'AI Tooling', description: 'AI-powered developer tools', item_count: 3, items: ['Item C'] },
      { id: 'id-3', name: 'Game Design', description: 'Game mechanics and design', item_count: 5, items: ['Item D'] },
    ]

    const result = await suggestMerges(containers)

    expect(result).not.toBeNull()
    expect(result!.merges).toHaveLength(1)
    expect(result!.merges[0]).toEqual({
      source: 'id-2',
      target: 'id-1',
      reason: 'Both cover AI development tools'
    })
    expect(result!.cost).toBeCloseTo(0.00006)
  })

  it('returns empty merges when no overlap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: { content: JSON.stringify({ merges: [] }) }
        }],
        usage: { prompt_tokens: 200, completion_tokens: 10 }
      })
    })

    const { suggestMerges } = await import('./containers')

    const containers = [
      { id: 'id-1', name: 'AI Dev Tools', description: 'Tools for AI', item_count: 8, items: ['Item A'] },
      { id: 'id-3', name: 'Game Design', description: 'Game mechanics', item_count: 5, items: ['Item B'] },
    ]

    const result = await suggestMerges(containers)
    expect(result).not.toBeNull()
    expect(result!.merges).toHaveLength(0)
  })

  it('returns null when fewer than 2 containers', async () => {
    const { suggestMerges } = await import('./containers')

    const result = await suggestMerges([
      { id: 'id-1', name: 'Solo', description: null, item_count: 3, items: ['Item A'] }
    ])

    expect(result).toBeNull()
  })

  it('returns null when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY
    const { suggestMerges } = await import('./containers')

    const result = await suggestMerges([
      { id: 'id-1', name: 'A', description: null, item_count: 1, items: [] },
      { id: 'id-2', name: 'B', description: null, item_count: 1, items: [] },
    ])

    expect(result).toBeNull()
  })

  it('returns null when OpenAI API returns error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limit exceeded'),
    })

    const { suggestMerges } = await import('./containers')
    const result = await suggestMerges([
      { id: 'id-1', name: 'A', description: null, item_count: 1, items: [] },
      { id: 'id-2', name: 'B', description: null, item_count: 1, items: [] },
    ])
    expect(result).toBeNull()
  })

  it('validates source/target IDs exist in input', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              merges: [
                { source: 'id-2', target: 'id-1', reason: 'Overlap' },
                { source: 'id-fake', target: 'id-1', reason: 'Hallucinated' }
              ]
            })
          }
        }],
        usage: { prompt_tokens: 200, completion_tokens: 50 }
      })
    })

    const { suggestMerges } = await import('./containers')

    const containers = [
      { id: 'id-1', name: 'A', description: null, item_count: 5, items: ['X'] },
      { id: 'id-2', name: 'B', description: null, item_count: 2, items: ['Y'] },
    ]

    const result = await suggestMerges(containers)
    expect(result!.merges).toHaveLength(1)
    expect(result!.merges[0].source).toBe('id-2')
  })
})
