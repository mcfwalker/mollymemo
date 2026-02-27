import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from './route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

describe('User Settings API Routes', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  describe('GET /api/users/settings', () => {
    it('should return user settings', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.single.mockResolvedValue({
        data: {
          timezone: 'America/New_York',
          report_frequency: 'weekly',
        },
        error: null,
      })

      const request = new NextRequest('http://localhost/api/users/settings')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        timezone: 'America/New_York',
        report_frequency: 'weekly',
      })
    })

    it('should return defaults for null values', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.single.mockResolvedValue({
        data: {
          timezone: null,
          report_frequency: null,
        },
        error: null,
      })

      const request = new NextRequest('http://localhost/api/users/settings')
      const response = await GET(request)
      const data = await response.json()

      expect(data).toEqual({
        timezone: 'America/Los_Angeles',
        report_frequency: 'daily',
      })
    })

    it('should return 401 for unauthenticated requests', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null)

      const request = new NextRequest('http://localhost/api/users/settings')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when user not found', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: new Error('Not found'),
      })

      const request = new NextRequest('http://localhost/api/users/settings')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('User not found')
    })
  })

  describe('PATCH /api/users/settings', () => {
    it('should update report_frequency', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.eq.mockResolvedValue({ error: null })

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ report_frequency: 'weekly' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockSupabase.update).toHaveBeenCalledWith({ report_frequency: 'weekly' })
    })

    it('should reject invalid report_frequency', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ report_frequency: 'hourly' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid report frequency')
    })

    it('should update timezone with valid IANA timezone', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.eq.mockResolvedValue({ error: null })

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: 'Europe/London' }),
      })

      const response = await PATCH(request)

      expect(response.status).toBe(200)
      expect(mockSupabase.update).toHaveBeenCalledWith({ timezone: 'Europe/London' })
    })

    it('should reject invalid timezone', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: 'Invalid/Timezone' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid timezone')
    })

    it('should update multiple fields at once', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.eq.mockResolvedValue({ error: null })

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          report_frequency: 'weekly',
          timezone: 'Asia/Tokyo',
        }),
      })

      const response = await PATCH(request)

      expect(response.status).toBe(200)
      expect(mockSupabase.update).toHaveBeenCalledWith({
        report_frequency: 'weekly',
        timezone: 'Asia/Tokyo',
      })
    })

    it('should ignore unknown fields', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.eq.mockResolvedValue({ error: null })

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          report_frequency: 'daily',
          unknown_field: 'ignored',
        }),
      })

      const response = await PATCH(request)

      expect(response.status).toBe(200)
      expect(mockSupabase.update).toHaveBeenCalledWith({ report_frequency: 'daily' })
    })

    it('should return 400 when no valid updates provided', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ unknown_field: 'value' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('No valid updates')
    })

    it('should return 401 for unauthenticated requests', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null)

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ report_frequency: 'daily' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 500 on database error', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.eq.mockResolvedValue({ error: new Error('DB error') })

      const request = new NextRequest('http://localhost/api/users/settings', {
        method: 'PATCH',
        body: JSON.stringify({ report_frequency: 'daily' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to update')
    })
  })
})
