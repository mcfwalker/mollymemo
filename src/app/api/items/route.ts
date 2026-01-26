import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { sanitizeSearchInput } from '@/lib/security'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const domain = searchParams.get('domain')
  const contentType = searchParams.get('type')
  const status = searchParams.get('status')
  const search = searchParams.get('q')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')

  const supabase = createServerClient()

  let query = supabase
    .from('items')
    .select('*', { count: 'exact' })
    .order('captured_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (domain) {
    query = query.eq('domain', domain)
  }

  if (contentType) {
    query = query.eq('content_type', contentType)
  }

  if (status) {
    query = query.eq('status', status)
  }

  if (search) {
    // Sanitize input to prevent SQL injection in PostgREST filters
    const sanitized = sanitizeSearchInput(search)
    // Search title, summary, transcript, and tags (cast to text for partial match)
    query = query.or(`title.ilike.%${sanitized}%,summary.ilike.%${sanitized}%,transcript.ilike.%${sanitized}%,tags::text.ilike.%${sanitized}%`)
  }

  const { data, error, count } = await query

  if (error) {
    console.error('Query error:', error)
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
  }

  return NextResponse.json({
    items: data || [],
    total: count || 0,
  })
}
