import { NextRequest, NextResponse } from 'next/server'
import { resolveUserId } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { detectSourceType } from '@/lib/processors/detect'
import { inngest } from '@/inngest/client'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL || 'https://mollymemo.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  // 1. Authenticate via API key or session
  const userId = await resolveUserId(request)
  if (!userId) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // 2. Parse body and extract URL
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { url } = body
  if (!url || typeof url !== 'string') {
    return jsonResponse({ error: 'Missing or invalid url field' }, 400)
  }

  // 3. Validate URL format
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return jsonResponse({ error: 'Invalid URL format' }, 400)
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
    return jsonResponse({ error: 'Already captured recently' }, 409)
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
    return jsonResponse({ error: 'Failed to capture' }, 500)
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

  return jsonResponse({ id: item.id, status: 'pending' }, 201)
}
