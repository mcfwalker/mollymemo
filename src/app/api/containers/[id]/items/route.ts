import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'
import logger from '@/lib/logger'

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

  // Verify container belongs to user
  const { data: container, error: containerError } = await supabase
    .from('containers')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (containerError || !container) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 })
  }

  // Get item IDs in this container
  const { data: containerItems, error: ciError } = await supabase
    .from('container_items')
    .select('item_id')
    .eq('container_id', id)

  if (ciError) {
    logger.error({ err: ciError }, 'Container items fetch error')
    return NextResponse.json({ error: 'Failed to fetch container items' }, { status: 500 })
  }

  const itemIds = (containerItems || []).map(ci => ci.item_id)

  if (itemIds.length === 0) {
    return NextResponse.json({ items: [] })
  }

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('id, title, source_url, domain, content_type, tags, captured_at, status')
    .in('id', itemIds)
    .order('captured_at', { ascending: false })

  if (itemsError) {
    logger.error({ err: itemsError }, 'Items fetch error')
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
  }

  return NextResponse.json({ items: items || [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: targetContainerId } = await params

  try {
    const body = await request.json()
    const { item_id, from_container_id } = body

    if (!item_id) {
      return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Verify target container belongs to user
    const { data: container, error: containerError } = await supabase
      .from('containers')
      .select('id')
      .eq('id', targetContainerId)
      .eq('user_id', userId)
      .single()

    if (containerError || !container) {
      return NextResponse.json({ error: 'Container not found' }, { status: 404 })
    }

    // Verify item belongs to user
    const { data: item, error: itemError } = await supabase
      .from('items')
      .select('id')
      .eq('id', item_id)
      .eq('user_id', userId)
      .single()

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Add item to target container
    const { error: insertError } = await supabase
      .from('container_items')
      .upsert(
        { container_id: targetContainerId, item_id },
        { onConflict: 'container_id,item_id' }
      )

    if (insertError) {
      logger.error({ err: insertError }, 'Move item error')
      return NextResponse.json({ error: 'Failed to move item' }, { status: 500 })
    }

    // Remove from source container if specified
    if (from_container_id) {
      const { error: removeError } = await supabase
        .from('container_items')
        .delete()
        .eq('container_id', from_container_id)
        .eq('item_id', item_id)

      if (removeError) {
        logger.error({ err: removeError, fromContainerId: from_container_id }, 'Remove from source container error')
      }
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
