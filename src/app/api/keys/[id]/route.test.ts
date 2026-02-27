import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock dependencies before importing route handlers
vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: vi.fn(),
}))

import { DELETE } from './route'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

describe('API Keys [id] Routes', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  describe('DELETE /api/keys/[id]', () => {
    it('should revoke an API key (soft delete)', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')

      // The chain: from().update().eq('id').eq('user_id').is('revoked_at', null)
      mockSupabase.is.mockResolvedValue({
        error: null,
      })

      const request = new NextRequest('http://localhost/api/keys/key-1', {
        method: 'DELETE',
      })

      const response = await DELETE(request, { params: Promise.resolve({ id: 'key-1' }) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      expect(mockSupabase.from).toHaveBeenCalledWith('api_keys')
      expect(mockSupabase.update).toHaveBeenCalledWith({
        revoked_at: expect.any(String),
      })
      // Verify the two .eq() and one .is() calls
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'key-1')
      expect(mockSupabase.eq).toHaveBeenCalledWith('user_id', 'user-123')
      expect(mockSupabase.is).toHaveBeenCalledWith('revoked_at', null)
    })

    it('should return 401 for unauthenticated requests', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null)

      const request = new NextRequest('http://localhost/api/keys/key-1', {
        method: 'DELETE',
      })

      const response = await DELETE(request, { params: Promise.resolve({ id: 'key-1' }) })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 500 on database error', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.is.mockResolvedValue({
        error: new Error('DB error'),
      })

      const request = new NextRequest('http://localhost/api/keys/key-1', {
        method: 'DELETE',
      })

      const response = await DELETE(request, { params: Promise.resolve({ id: 'key-1' }) })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to revoke API key')
    })
  })
})
