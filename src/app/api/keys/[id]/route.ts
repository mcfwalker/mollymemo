/**
 * API Key [id] Route
 *
 * Manages individual API key operations.
 *
 * DELETE /api/keys/[id] - Revoke an API key (soft delete)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

/**
 * Revoke an API key by setting revoked_at timestamp (soft delete).
 *
 * Only revokes keys owned by the current user that haven't already been revoked.
 *
 * @param request - Contains auth header
 * @param params - Route params with key id
 * @returns { success: true } or error
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('revoked_at', null)

  if (error) {
    console.error('Failed to revoke API key:', error)
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
