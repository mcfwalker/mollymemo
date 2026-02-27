import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock dependencies before imports
vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  resolveUserId: vi.fn(),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/processors/detect', () => ({
  detectSourceType: vi.fn().mockReturnValue('article'),
}))

import { POST } from './route'
import { createServiceClient } from '@/lib/supabase'
import { resolveUserId } from '@/lib/auth'
import { inngest } from '@/inngest/client'
import { detectSourceType } from '@/lib/processors/detect'

const TEST_USER_ID = 'user-uuid-123'
const TEST_URL = 'https://example.com/article'
const TEST_ITEM_ID = 'item-uuid-456'

function createRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/capture', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer test-api-key' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/capture', () => {
  let selectResult: { data: unknown[] | null; error: unknown }
  let insertResult: { data: { id: string } | null; error: unknown }

  beforeEach(() => {
    vi.clearAllMocks()

    selectResult = { data: [], error: null }
    insertResult = { data: { id: TEST_ITEM_ID }, error: null }

    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockImplementation((columns?: string) => {
        // After insert(), .select('id') leads to .single()
        if (columns === 'id') {
          return {
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            limit: vi.fn().mockImplementation(() => selectResult),
            single: vi.fn().mockImplementation(() => insertResult),
          }
        }
        return mockSupabase
      }),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => selectResult),
      single: vi.fn().mockImplementation(() => insertResult),
    }

    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
    vi.mocked(resolveUserId).mockResolvedValue(TEST_USER_ID)
    vi.mocked(detectSourceType).mockReturnValue('article')
  })

  it('captures a URL successfully and returns 201', async () => {
    const request = createRequest({ url: TEST_URL })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data).toEqual({ id: TEST_ITEM_ID, status: 'pending' })
    expect(inngest.send).toHaveBeenCalledWith({
      name: 'item/captured',
      data: {
        itemId: TEST_ITEM_ID,
        sourceType: 'article',
        sourceUrl: TEST_URL,
        userId: TEST_USER_ID,
      },
    })
    expect(detectSourceType).toHaveBeenCalledWith(TEST_URL)
  })

  it('returns 401 for invalid API key', async () => {
    vi.mocked(resolveUserId).mockResolvedValue(null)

    const request = createRequest({ url: TEST_URL })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 for missing URL', async () => {
    const request = createRequest({})

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('returns 400 for non-string URL', async () => {
    const request = createRequest({ url: 123 })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('returns 400 for invalid URL format', async () => {
    const request = createRequest({ url: 'not-a-valid-url' })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBeDefined()
  })

  it('returns 409 for duplicate URL within 24h', async () => {
    selectResult = { data: [{ id: 'existing-item-id' }], error: null }

    const request = createRequest({ url: TEST_URL })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Already captured recently')
    // Should NOT have called insert or inngest
    expect(inngest.send).not.toHaveBeenCalled()
  })
})
