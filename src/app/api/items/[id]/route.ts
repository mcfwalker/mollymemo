/**
 * Single Item API Route
 *
 * CRUD operations for individual items. All operations verify user ownership.
 *
 * GET /api/items/[id] - Get item details
 * PATCH /api/items/[id] - Update item fields (domain, title, tags, etc.)
 * DELETE /api/items/[id] - Delete item
 * POST /api/items/[id] - Reprocess item (re-run AI classification)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import { getCurrentUserId } from '@/lib/auth'
import logger from '@/lib/logger'

/**
 * Get a single item by ID.
 *
 * @param request - Contains auth header
 * @param params - Contains item ID
 * @returns Item details or 404 if not found
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

/**
 * Update an item's metadata.
 * Allowed fields: domain, content_type, tags, title, summary
 *
 * @param request - JSON body with fields to update
 * @param params - Contains item ID
 * @returns Updated item or error
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const body = await request.json()

    // Only allow updating certain fields
    const allowedFields = ['domain', 'content_type', 'tags', 'title', 'summary']
    const updates: Record<string, unknown> = {}

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      logger.error({ err: error }, 'Item update error')
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json(data)

  } catch (error) {
    logger.error({ err: error }, 'Item PATCH error')
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

/**
 * Delete an item.
 *
 * @param request - Contains auth header
 * @param params - Contains item ID
 * @returns Success confirmation or error
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
    .from('items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    logger.error({ err: error }, 'Item delete error')
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

/**
 * Trigger reprocessing of an item.
 * Resets status to pending and re-runs AI classification pipeline.
 *
 * @param request - Contains auth header
 * @param params - Contains item ID
 * @returns Confirmation that reprocessing has started
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServiceClient()

  // Verify item exists and belongs to user, get details for Inngest event
  const { data: item, error } = await supabase
    .from('items')
    .select('id, status, source_type, source_url, user_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error || !item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  // Reset status to pending before reprocessing
  await supabase
    .from('items')
    .update({ status: 'pending', error_message: null })
    .eq('id', id)
    .eq('user_id', userId)

  // Send to Inngest for processing (no chatId - retry doesn't send Telegram notification)
  await inngest.send({
    name: 'item/captured',
    data: {
      itemId: id,
      sourceType: item.source_type,
      sourceUrl: item.source_url,
      userId: item.user_id,
    },
  })

  return NextResponse.json({
    id,
    status: 'reprocessing',
    message: 'Item queued for reprocessing',
  })
}
