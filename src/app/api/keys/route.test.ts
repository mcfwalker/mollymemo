import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock dependencies before importing route handlers
vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: vi.fn(),
}))

// Mock Node.js crypto module
vi.mock('crypto', () => ({
  randomBytes: vi.fn(),
  createHash: vi.fn(),
}))

import { POST, GET } from './route'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'
import { randomBytes, createHash } from 'crypto'

describe('API Keys Routes', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  describe('POST /api/keys', () => {
    const fakeKey = 'mm_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const fakeHash = 'abc123hashvalue'

    beforeEach(() => {
      // Mock randomBytes to return a buffer that produces a known base64url string
      const mockBuffer = {
        toString: vi.fn().mockReturnValue('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      }
      vi.mocked(randomBytes).mockReturnValue(mockBuffer as never)

      // Mock createHash chain
      const mockHasher = {
        update: vi.fn().mockReturnThis(),
        digest: vi.fn().mockReturnValue(fakeHash),
      }
      vi.mocked(createHash).mockReturnValue(mockHasher as never)
    })

    it('should create an API key with default name', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.single.mockResolvedValue({
        data: {
          id: 'key-1',
          name: 'Chrome Extension',
          created_at: '2026-02-26T00:00:00Z',
        },
        error: null,
      })

      const request = new NextRequest('http://localhost/api/keys', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.id).toBe('key-1')
      expect(data.name).toBe('Chrome Extension')
      expect(data.created_at).toBe('2026-02-26T00:00:00Z')
      expect(data.key).toBe(fakeKey)

      // Verify DB insert used the hash, not the plaintext key
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        user_id: 'user-123',
        key_hash: fakeHash,
        name: 'Chrome Extension',
      })
    })

    it('should create an API key with a custom name', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.single.mockResolvedValue({
        data: {
          id: 'key-2',
          name: 'My Custom Key',
          created_at: '2026-02-26T00:00:00Z',
        },
        error: null,
      })

      const request = new NextRequest('http://localhost/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Custom Key' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.name).toBe('My Custom Key')
      expect(data.key).toBe(fakeKey)

      expect(mockSupabase.insert).toHaveBeenCalledWith({
        user_id: 'user-123',
        key_hash: fakeHash,
        name: 'My Custom Key',
      })
    })

    it('should return 401 for unauthenticated requests', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null)

      const request = new NextRequest('http://localhost/api/keys', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 500 on database error', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: new Error('DB error'),
      })

      const request = new NextRequest('http://localhost/api/keys', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create API key')
    })
  })

  describe('GET /api/keys', () => {
    it('should return a list of active API keys', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')

      const mockKeys = [
        {
          id: 'key-1',
          name: 'Chrome Extension',
          created_at: '2026-02-26T00:00:00Z',
          last_used_at: '2026-02-26T12:00:00Z',
        },
        {
          id: 'key-2',
          name: 'CLI Tool',
          created_at: '2026-02-25T00:00:00Z',
          last_used_at: null,
        },
      ]

      // The chain: from().select().eq().is().order()
      mockSupabase.order.mockResolvedValue({
        data: mockKeys,
        error: null,
      })

      const request = new NextRequest('http://localhost/api/keys')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.keys).toEqual(mockKeys)
      expect(data.keys).toHaveLength(2)

      expect(mockSupabase.from).toHaveBeenCalledWith('api_keys')
      expect(mockSupabase.select).toHaveBeenCalledWith('id, name, created_at, last_used_at')
      expect(mockSupabase.eq).toHaveBeenCalledWith('user_id', 'user-123')
      expect(mockSupabase.is).toHaveBeenCalledWith('revoked_at', null)
      expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: false })
    })

    it('should return empty array when no keys exist', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.order.mockResolvedValue({
        data: [],
        error: null,
      })

      const request = new NextRequest('http://localhost/api/keys')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.keys).toEqual([])
    })

    it('should return 401 for unauthenticated requests', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null)

      const request = new NextRequest('http://localhost/api/keys')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 500 on database error', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.order.mockResolvedValue({
        data: null,
        error: new Error('DB error'),
      })

      const request = new NextRequest('http://localhost/api/keys')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to list API keys')
    })
  })
})
