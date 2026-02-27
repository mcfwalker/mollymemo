/**
 * API Keys Route
 *
 * Manages API key creation and listing for programmatic access.
 *
 * POST /api/keys - Generate a new API key (plaintext shown once)
 * GET /api/keys - List active (non-revoked) API keys
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

/**
 * Generate a new API key.
 *
 * Creates a random key prefixed with 'mm_', stores the SHA-256 hash
 * in the database, and returns the plaintext key exactly once.
 *
 * @param request - JSON body with optional `name` (default: 'Chrome Extension')
 * @returns 201 with { id, name, created_at, key } or error
 */
export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const name = body.name || 'Chrome Extension'

  // Generate random key with mm_ prefix
  const plainKey = 'mm_' + randomBytes(32).toString('base64url')

  // Hash for storage — never store the plaintext key
  const keyHash = createHash('sha256').update(plainKey).digest('hex')

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('api_keys')
    .insert({ user_id: userId, key_hash: keyHash, name })
    .select('id, name, created_at')
    .single()

  if (error) {
    console.error('Failed to create API key:', error)
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }

  // Return plaintext key once — it cannot be retrieved again
  return NextResponse.json({ ...data, key: plainKey }, { status: 201 })
}

/**
 * List active (non-revoked) API keys for the current user.
 *
 * @param request - Contains auth header
 * @returns { keys: [{ id, name, created_at, last_used_at }] }
 */
export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, created_at, last_used_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to list API keys:', error)
    return NextResponse.json({ error: 'Failed to list API keys' }, { status: 500 })
  }

  return NextResponse.json({ keys: data })
}
