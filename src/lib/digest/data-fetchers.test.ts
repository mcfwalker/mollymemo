import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import {
  getContainerActivity,
  getCrossReferences,
  getProjectMatches,
} from './data-fetchers'

describe('Digest Data Fetchers', () => {
  let mockSupabase: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      rpc: vi.fn(),
    }
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  describe('getContainerActivity', () => {
    it('should return containers with item counts in window', async () => {
      const since = new Date('2026-02-20T00:00:00Z')
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'container_items') {
          return {
            select: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { container_id: 'c1', item_id: 'i1', containers: { id: 'c1', name: 'AI Tools', item_count: 10, created_at: '2026-01-01T00:00:00Z' } },
                    { container_id: 'c1', item_id: 'i2', containers: { id: 'c1', name: 'AI Tools', item_count: 10, created_at: '2026-01-01T00:00:00Z' } },
                    { container_id: 'c2', item_id: 'i3', containers: { id: 'c2', name: 'New Bucket', item_count: 1, created_at: '2026-02-20T12:00:00Z' } },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        return mockSupabase
      })

      const result = await getContainerActivity('user-1', since)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        containerId: 'c1',
        containerName: 'AI Tools',
        itemCountInWindow: 2,
        totalItemCount: 10,
        isNew: false,
      })
      expect(result[1]).toEqual({
        containerId: 'c2',
        containerName: 'New Bucket',
        itemCountInWindow: 1,
        totalItemCount: 1,
        isNew: true,
      })
    })

    it('should return empty array on error', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
          }),
        }),
      }))

      const result = await getContainerActivity('user-1', new Date())
      expect(result).toEqual([])
    })
  })

  describe('getCrossReferences', () => {
    it('should return items appearing in 2+ containers', async () => {
      const since = new Date('2026-02-20T00:00:00Z')
      const windowItems = [
        { id: 'i1', title: 'LLM Agents Guide', source_url: 'https://example.com/agents' },
        { id: 'i2', title: 'React Tutorial', source_url: 'https://example.com/react' },
      ]
      const containerItems = [
        { item_id: 'i1', containers: { name: 'AI Tools' } },
        { item_id: 'i1', containers: { name: 'Side Projects' } },
        { item_id: 'i2', containers: { name: 'Frontend' } },
      ]

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: windowItems, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'container_items') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: containerItems, error: null }),
            }),
          }
        }
        return mockSupabase
      })

      const result = await getCrossReferences('user-1', since)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        itemId: 'i1',
        itemTitle: 'LLM Agents Guide',
        sourceUrl: 'https://example.com/agents',
        containerNames: ['AI Tools', 'Side Projects'],
      })
    })

    it('should return empty array when no cross-references exist', async () => {
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }))

      const result = await getCrossReferences('user-1', new Date())
      expect(result).toEqual([])
    })
  })

  describe('getProjectMatches', () => {
    it('should match items to projects by tag intersection', async () => {
      const since = new Date('2026-02-20T00:00:00Z')
      const anchors = [
        { name: 'Agent Framework', description: 'Building AI agents', tags: ['ai', 'agents', 'llm'] },
        { name: 'Blog Redesign', description: 'New blog layout', tags: ['frontend', 'css'] },
      ]
      const items = [
        { id: 'i1', title: 'LLM Orchestration', tags: ['ai', 'agents'] },
        { id: 'i2', title: 'CSS Grid Guide', tags: ['css', 'frontend'] },
        { id: 'i3', title: 'Cooking Recipe', tags: ['food'] },
      ]

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'project_anchors') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: anchors, error: null }),
              }),
            }),
          }
        }
        if (table === 'items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: items, error: null }),
                }),
              }),
            }),
          }
        }
        return mockSupabase
      })

      const result = await getProjectMatches('user-1', since)

      expect(result).toHaveLength(2)
      expect(result[0].projectName).toBe('Agent Framework')
      expect(result[0].matchedItems).toHaveLength(1)
      expect(result[0].matchedItems[0].itemId).toBe('i1')
      expect(result[0].matchedItems[0].matchedTags).toEqual(['ai', 'agents'])

      expect(result[1].projectName).toBe('Blog Redesign')
      expect(result[1].matchedItems).toHaveLength(1)
      expect(result[1].matchedItems[0].itemId).toBe('i2')
    })

    it('should exclude projects with no matching items', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'project_anchors') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [{ name: 'Unrelated Project', description: null, tags: ['quantum'] }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [{ id: 'i1', title: 'React App', tags: ['react'] }],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return mockSupabase
      })

      const result = await getProjectMatches('user-1', new Date())
      expect(result).toEqual([])
    })

    it('should return empty array when no project anchors exist', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'project_anchors') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }
        }
        return mockSupabase
      })

      const result = await getProjectMatches('user-1', new Date())
      expect(result).toEqual([])
    })
  })
})
