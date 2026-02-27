import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock dependencies before importing the module under test
vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'

// Import AFTER mocks
import { resolveUserId, getCurrentUserId } from './auth'

describe('resolveUserId', () => {
  // Supabase query builder is thenable — add then/catch so fire-and-forget works
  const mockSupabase: Record<string, ReturnType<typeof vi.fn>> = {}
  Object.assign(mockSupabase, {
    from: vi.fn(() => mockSupabase),
    select: vi.fn(() => mockSupabase),
    eq: vi.fn(() => mockSupabase),
    is: vi.fn(() => mockSupabase),
    single: vi.fn(),
    update: vi.fn(() => mockSupabase),
    then: vi.fn((cb: (v: unknown) => void) => { cb(undefined); return mockSupabase }),
    catch: vi.fn(() => mockSupabase),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  it('resolves user from x-user-id header (session auth)', async () => {
    const request = new NextRequest('http://localhost/api/capture', {
      headers: { 'x-user-id': 'user-session-123' },
    })

    const userId = await resolveUserId(request)

    expect(userId).toBe('user-session-123')
    // Should NOT have queried the api_keys table
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('resolves user from Bearer token (API key auth)', async () => {
    const request = new NextRequest('http://localhost/api/capture', {
      headers: { Authorization: 'Bearer mm_testkey123' },
    })

    mockSupabase.single.mockResolvedValue({
      data: { user_id: 'user-apikey-456' },
      error: null,
    })

    // update chain for last_used_at fire-and-forget
    mockSupabase.update.mockReturnValue(mockSupabase)

    const userId = await resolveUserId(request)

    expect(userId).toBe('user-apikey-456')
    expect(mockSupabase.from).toHaveBeenCalledWith('api_keys')
    expect(mockSupabase.select).toHaveBeenCalledWith('user_id')
    expect(mockSupabase.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('returns null when no auth provided', async () => {
    const request = new NextRequest('http://localhost/api/capture')

    const userId = await resolveUserId(request)

    expect(userId).toBeNull()
  })

  it('returns null for invalid Bearer token (not in DB)', async () => {
    const request = new NextRequest('http://localhost/api/capture', {
      headers: { Authorization: 'Bearer mm_invalidkey' },
    })

    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    })

    const userId = await resolveUserId(request)

    expect(userId).toBeNull()
    // Should NOT fall through to session auth
    expect(mockSupabase.from).toHaveBeenCalledWith('api_keys')
  })

  it('fires and forgets last_used_at update on successful API key auth', async () => {
    const request = new NextRequest('http://localhost/api/capture', {
      headers: { Authorization: 'Bearer mm_testkey123' },
    })

    mockSupabase.single.mockResolvedValue({
      data: { user_id: 'user-apikey-456' },
      error: null,
    })
    mockSupabase.update.mockReturnValue(mockSupabase)

    await resolveUserId(request)

    // Verify the fire-and-forget update was called
    expect(mockSupabase.from).toHaveBeenCalledWith('api_keys')
    expect(mockSupabase.update).toHaveBeenCalled()
  })
})

describe('getCurrentUserId', () => {
  it('returns user ID from x-user-id header', () => {
    const request = new NextRequest('http://localhost/api/test', {
      headers: { 'x-user-id': 'user-abc' },
    })
    expect(getCurrentUserId(request)).toBe('user-abc')
  })

  it('returns null when no x-user-id header', () => {
    const request = new NextRequest('http://localhost/api/test')
    expect(getCurrentUserId(request)).toBeNull()
  })
})
