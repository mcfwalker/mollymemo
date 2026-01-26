import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { detectSourceType } from '@/lib/processors/detect'
import { processItem } from '@/lib/processors'
import { secureCompare } from '@/lib/security'

// Validate auth token with timing-safe comparison
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false

  const token = authHeader.slice(7)
  const apiKey = process.env.API_SECRET_KEY || ''

  return secureCompare(token, apiKey)
}

export async function POST(request: NextRequest) {
  // Auth check
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { url } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL required' }, { status: 400 })
    }

    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Reject malformed hostnames (iOS Share Sheet sometimes sends garbage)
    const hostname = parsedUrl.hostname.toLowerCase()
    if (
      !hostname ||
      hostname === 'null' ||
      hostname === '(null)' ||
      hostname === 'undefined' ||
      !hostname.includes('.')
    ) {
      return NextResponse.json(
        { error: 'Invalid URL: malformed hostname' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // Check for recent duplicate (same URL in last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('items')
      .select('id')
      .eq('source_url', parsedUrl.href)
      .gte('captured_at', oneDayAgo)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({
        id: existing[0].id,
        status: 'duplicate',
        message: 'Already captured recently',
      })
    }

    // Detect source type
    const sourceType = detectSourceType(parsedUrl.href)

    // Insert the item
    const { data: item, error } = await supabase
      .from('items')
      .insert({
        source_url: parsedUrl.href,
        source_type: sourceType,
        status: 'pending',
      })
      .select('id')
      .single()

    if (error || !item) {
      console.error('Insert error:', error)
      return NextResponse.json({ error: 'Failed to capture' }, { status: 500 })
    }

    // Process synchronously (serverless can't do true background work)
    // This should complete within Vercel's timeout for GitHub/article sources
    // TikTok transcription might need a different approach later
    try {
      await processItem(item.id)
    } catch (err) {
      console.error('Processing error:', err)
      // Item stays in 'failed' state, but capture still succeeded
    }

    // Fetch the processed item to return current state
    const { data: processed } = await supabase
      .from('items')
      .select('id, status, title, source_type')
      .eq('id', item.id)
      .single()

    return NextResponse.json({
      id: item.id,
      status: processed?.status || 'captured',
      title: processed?.title,
      source_type: sourceType,
    })

  } catch (error) {
    console.error('Capture error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
