import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { processItem } from '@/lib/processors'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const supabase = createServerClient()

    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update error:', error)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json(data)

  } catch (error) {
    console.error('PATCH error:', error)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()

  const { error } = await supabase
    .from('items')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// POST: Reprocess an item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()

  // Verify item exists
  const { data: item, error } = await supabase
    .from('items')
    .select('id, status')
    .eq('id', id)
    .single()

  if (error || !item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  // Reset status to pending before reprocessing
  await supabase
    .from('items')
    .update({ status: 'pending', error_message: null })
    .eq('id', id)

  // Fire-and-forget: process in background
  processItem(id).catch(err => {
    console.error('Reprocess error:', err)
  })

  return NextResponse.json({
    id,
    status: 'reprocessing',
    message: 'Item queued for reprocessing',
  })
}
