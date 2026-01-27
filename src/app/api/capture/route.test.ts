import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

// Mock dependencies
vi.mock('@/lib/supabase', () => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/processors', () => ({
  processItem: vi.fn(),
}))

vi.mock('@/lib/security', () => ({
  secureCompare: vi.fn((a: string, b: string) => a === b && a !== ''),
}))

import { createServerClient } from '@/lib/supabase'
import { processItem } from '@/lib/processors'

// Helper to create mock NextRequest
function createMockRequest(
  body: Record<string, unknown>,
  authHeader?: string
): NextRequest {
  const request = new NextRequest('http://localhost/api/capture', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: authHeader ? { authorization: authHeader } : {},
  })
  return request
}

describe('capture API route', () => {
  const originalEnv = process.env
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    gte: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    process.env = { ...originalEnv, API_SECRET_KEY: 'test-secret-key' }

    // Create chainable mock for Supabase
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }

    // Wire up the chain
    mockSupabase.from.mockReturnValue(mockSupabase)
    mockSupabase.select.mockReturnValue(mockSupabase)
    mockSupabase.insert.mockReturnValue(mockSupabase)
    mockSupabase.eq.mockReturnValue(mockSupabase)
    mockSupabase.gte.mockReturnValue(mockSupabase)
    mockSupabase.limit.mockReturnValue({ data: null })
    mockSupabase.single.mockReturnValue({ data: { id: 'new-item-id' }, error: null })

    vi.mocked(createServerClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof createServerClient>)
    vi.mocked(processItem).mockResolvedValue(undefined)

    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  describe('authorization', () => {
    it('returns 401 without authorization header', async () => {
      const request = createMockRequest({ url: 'https://example.com' })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('returns 401 with invalid authorization format', async () => {
      const request = createMockRequest({ url: 'https://example.com' }, 'Basic abc123')

      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('returns 401 with wrong token', async () => {
      const request = createMockRequest({ url: 'https://example.com' }, 'Bearer wrong-token')

      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('accepts valid bearer token', async () => {
      const request = createMockRequest(
        { url: 'https://example.com' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)

      expect(response.status).not.toBe(401)
    })
  })

  describe('URL validation', () => {
    it('returns 400 when URL is missing', async () => {
      const request = createMockRequest({}, 'Bearer test-secret-key')

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('URL required')
    })

    it('returns 400 when URL is not a string', async () => {
      const request = createMockRequest({ url: 123 }, 'Bearer test-secret-key')

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('URL required')
    })

    it('returns 400 for invalid URL format', async () => {
      const request = createMockRequest({ url: 'not-a-url' }, 'Bearer test-secret-key')

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid URL')
    })

    it('returns 400 for malformed hostname: null', async () => {
      const request = createMockRequest(
        { url: 'https://null/path' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid URL: malformed hostname')
    })

    it('returns 400 for malformed hostname: (null)', async () => {
      // This tests iOS Share Sheet garbage
      const request = createMockRequest(
        { url: 'https://(null)/something' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid URL: malformed hostname')
    })

    it('returns 400 for hostname without dot', async () => {
      const request = createMockRequest(
        { url: 'https://localhost/path' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid URL: malformed hostname')
    })
  })

  describe('duplicate detection', () => {
    it('returns duplicate status when URL was captured recently', async () => {
      mockSupabase.limit.mockReturnValue({ data: [{ id: 'existing-id' }] })

      const request = createMockRequest(
        { url: 'https://example.com/page' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('duplicate')
      expect(data.id).toBe('existing-id')
      expect(data.message).toBe('Already captured recently')
    })

    it('proceeds with capture when no recent duplicate', async () => {
      mockSupabase.limit.mockReturnValue({ data: [] })

      const request = createMockRequest(
        { url: 'https://example.com/page' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('processing')
    })
  })

  describe('successful capture', () => {
    beforeEach(() => {
      mockSupabase.limit.mockReturnValue({ data: [] })
    })

    it('inserts item with correct data', async () => {
      const request = createMockRequest(
        { url: 'https://x.com/user/status/123' },
        'Bearer test-secret-key'
      )

      await POST(request)

      expect(mockSupabase.insert).toHaveBeenCalledWith({
        source_url: 'https://x.com/user/status/123',
        source_type: 'x',
        status: 'pending',
      })
    })

    it('returns processing status with item id', async () => {
      const request = createMockRequest(
        { url: 'https://tiktok.com/video' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        id: 'new-item-id',
        status: 'processing',
        source_type: 'tiktok',
      })
    })

    it('triggers background processing', async () => {
      const request = createMockRequest(
        { url: 'https://example.com/article' },
        'Bearer test-secret-key'
      )

      await POST(request)

      expect(processItem).toHaveBeenCalledWith('new-item-id')
    })

    it('does not wait for processing to complete', async () => {
      // Make processItem take a long time
      vi.mocked(processItem).mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 10000))
      )

      const request = createMockRequest(
        { url: 'https://example.com/article' },
        'Bearer test-secret-key'
      )

      const start = Date.now()
      await POST(request)
      const elapsed = Date.now() - start

      // Should return immediately (well under 10 seconds)
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockSupabase.limit.mockReturnValue({ data: [] })
    })

    it('returns 500 on database insert error', async () => {
      mockSupabase.single.mockReturnValue({ data: null, error: { message: 'DB error' } })

      const request = createMockRequest(
        { url: 'https://example.com/page' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to capture')
    })

    it('handles processing errors gracefully', async () => {
      vi.mocked(processItem).mockRejectedValue(new Error('Processing failed'))

      const request = createMockRequest(
        { url: 'https://example.com/page' },
        'Bearer test-secret-key'
      )

      // Should not throw - processing is fire-and-forget
      const response = await POST(request)

      expect(response.status).toBe(200)
    })
  })

  describe('source type detection', () => {
    beforeEach(() => {
      mockSupabase.limit.mockReturnValue({ data: [] })
    })

    it('detects X/Twitter URLs', async () => {
      const request = createMockRequest(
        { url: 'https://twitter.com/user/status/123' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(data.source_type).toBe('x')
    })

    it('detects TikTok URLs', async () => {
      const request = createMockRequest(
        { url: 'https://www.tiktok.com/@user/video/123' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(data.source_type).toBe('tiktok')
    })

    it('detects GitHub URLs', async () => {
      const request = createMockRequest(
        { url: 'https://github.com/owner/repo' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(data.source_type).toBe('github')
    })

    it('defaults to article for unknown domains', async () => {
      const request = createMockRequest(
        { url: 'https://some-blog.com/post' },
        'Bearer test-secret-key'
      )

      const response = await POST(request)
      const data = await response.json()

      expect(data.source_type).toBe('article')
    })
  })
})
