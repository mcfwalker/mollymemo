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

  const { data, error } = await supabase
    .from('containers')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

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

    const allowedFields = ['name', 'description']
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
      .from('containers')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      logger.error({ err: error }, 'Container update error')
      return NextResponse.json({ error: 'Failed to update container' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const force = request.nextUrl.searchParams.get('force') === 'true'
  const supabase = createServiceClient()

  // Check if container exists and belongs to user
  const { data: container, error: fetchError } = await supabase
    .from('containers')
    .select('id, item_count')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !container) {
    return NextResponse.json({ error: 'Container not found' }, { status: 404 })
  }

  // Require force=true for non-empty containers
  if (container.item_count > 0 && !force) {
    return NextResponse.json(
      { error: 'Container is not empty. Use ?force=true to delete.' },
      { status: 409 }
    )
  }

  const { error } = await supabase
    .from('containers')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) {
    logger.error({ err: error }, 'Container delete error')
    return NextResponse.json({ error: 'Failed to delete container' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
