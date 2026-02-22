import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('detectVelocity', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects containers with >= 3 items in 14 days', async () => {
    const mockFrom = vi.fn()
    const supabase = { from: mockFrom } as any

    mockFrom.mockImplementation((table: string) => {
      if (table === 'containers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { id: 'c-1', name: 'Agent Orchestration', item_count: 8 },
                { id: 'c-2', name: 'Game Design', item_count: 2 },
              ],
              error: null,
            }),
          }),
        }
      }
      if (table === 'container_items') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              gte: vi.fn().mockResolvedValue({
                data: [
                  { container_id: 'c-1', items: { captured_at: '2026-02-20' } },
                  { container_id: 'c-1', items: { captured_at: '2026-02-19' } },
                  { container_id: 'c-1', items: { captured_at: '2026-02-18' } },
                  { container_id: 'c-1', items: { captured_at: '2026-02-17' } },
                  { container_id: 'c-2', items: { captured_at: '2026-02-20' } },
                ],
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    const { detectVelocity } = await import('./trends')
    const signals = await detectVelocity(supabase, 'user-1')

    expect(signals).toHaveLength(1)
    expect(signals[0].containerId).toBe('c-1')
    expect(signals[0].containerName).toBe('Agent Orchestration')
    expect(signals[0].itemCount14d).toBe(4)
  })

  it('returns empty when no containers have enough activity', async () => {
    const mockFrom = vi.fn()
    const supabase = { from: mockFrom } as any

    mockFrom.mockImplementation((table: string) => {
      if (table === 'containers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'c-1', name: 'Solo', item_count: 1 }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'container_items') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              gte: vi.fn().mockResolvedValue({
                data: [
                  { container_id: 'c-1', items: { captured_at: '2026-02-20' } },
                ],
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    const { detectVelocity } = await import('./trends')
    const signals = await detectVelocity(supabase, 'user-1')

    expect(signals).toHaveLength(0)
  })
})
