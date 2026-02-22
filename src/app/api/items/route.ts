/**
 * Items API Route
 *
 * Retrieves captured items for the authenticated user with filtering and pagination.
 *
 * GET /api/items - List items with optional filters
 *
 * Query Parameters:
 * - domain: Filter by domain (e.g., "vibe-coding", "ai-filmmaking")
 * - type: Filter by content type (e.g., "repo", "technique", "tool")
 * - status: Filter by processing status ("pending", "processed", "failed")
 * - q: Search query (searches title, summary, transcript, tags)
 * - limit: Max items to return (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sanitizeSearchInput } from '@/lib/security'
import { getCurrentUserId } from '@/lib/auth'

/**
 * Get items for the authenticated user with filtering and pagination.
 *
 * @param request - Contains query parameters for filtering
 * @returns { items: Item[], total: number }
 */
export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const domain = searchParams.get('domain')
  const contentType = searchParams.get('type')
  const status = searchParams.get('status')
  const search = searchParams.get('q')
  const container = searchParams.get('container')
  const project = searchParams.get('project')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')

  const supabase = createServiceClient()

  // If container filter, pre-fetch item IDs in that container
  let containerItemIds: string[] | null = null
  if (container) {
    const { data: ciData } = await supabase
      .from('container_items')
      .select('item_id')
      .eq('container_id', container)

    containerItemIds = (ciData || []).map(ci => ci.item_id)
    if (containerItemIds.length === 0) {
      return NextResponse.json({ items: [], total: 0 })
    }
  }

  // If project filter, pre-fetch item IDs tagged for that project
  let projectItemIds: string[] | null = null
  if (project) {
    const { data: prData } = await supabase
      .from('item_project_relevance')
      .select('item_id')
      .eq('project_anchor_id', project)

    projectItemIds = (prData || []).map(pr => pr.item_id)
    if (projectItemIds.length === 0) {
      return NextResponse.json({ items: [], total: 0 })
    }
  }

  let query = supabase
    .from('items')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('captured_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (containerItemIds) {
    query = query.in('id', containerItemIds)
  }

  if (projectItemIds) {
    query = query.in('id', projectItemIds)
  }

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
