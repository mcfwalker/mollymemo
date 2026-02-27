import { NextRequest, NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { detectSourceType } from '@/lib/processors/detect'
import { inngest } from '@/inngest/client'

export async function POST(request: NextRequest) {
  // 1. Authenticate via API key or session
  const userId = await resolveUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body and extract URL
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { url } = body
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid url field' }, { status: 400 })
  }

  // 3. Validate URL format
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // 4. Check for recent duplicate (same URL in last 24h for this user)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: existing } = await supabase
    .from('items')
    .select('id')
    .eq('source_url', parsedUrl.href)
    .eq('user_id', userId)
    .gte('captured_at', oneDayAgo)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Already captured recently' }, { status: 409 })
  }

  // 5. Detect source type and insert
  const sourceType = detectSourceType(parsedUrl.href)

  const { data: item, error } = await supabase
    .from('items')
    .insert({
      source_url: parsedUrl.href,
      source_type: sourceType,
      status: 'pending',
      user_id: userId,
    })
    .select('id')
    .single()

  if (error || !item) {
    console.error('Capture insert error:', error)
    return NextResponse.json({ error: 'Failed to capture' }, { status: 500 })
  }

  // 6. Send Inngest event for background processing
  await inngest.send({
    name: 'item/captured',
    data: {
      itemId: item.id,
      sourceType,
      sourceUrl: parsedUrl.href,
      userId,
    },
  })

  return NextResponse.json({ id: item.id, status: 'pending' }, { status: 201 })
}
