import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// Get current user ID from request headers (set by middleware)
export function getCurrentUserId(request: NextRequest): string | null {
  return request.headers.get('x-user-id')
}

// Require authenticated user, throws if not present
export function requireUserId(request: NextRequest): string {
  const userId = getCurrentUserId(request)
  if (!userId) {
    throw new Error('User ID not found in request')
  }
  return userId
}

// Resolve user ID from API key (Bearer token) or session auth (x-user-id header).
// Bearer token takes precedence: if present but invalid, returns null (no fallback).
export async function resolveUserId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization')

  // If Bearer token present, authenticate via API key
  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7)
    const keyHash = createHash('sha256').update(key).digest('hex')

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()

    if (error || !data) {
      return null
    }

    // Fire-and-forget: update last_used_at
    void supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', keyHash)

    return data.user_id
  }

  // Fallback to session auth (x-user-id header set by middleware)
  return getCurrentUserId(request)
}
