/**
 * Reports API Route
 *
 * GET /api/reports - List reports for the authenticated user
 *
 * Query Parameters:
 * - type: Filter by report_type ('daily' | 'weekly')
 * - limit: Max reports to return (default: 20, max: 50)
 * - offset: Pagination offset (default: 0)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const reportType = searchParams.get('type')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
  const offset = parseInt(searchParams.get('offset') || '0')

  const supabase = createServiceClient()

  let query = supabase
    .from('reports')
    .select('id, report_type, title, content, window_start, window_end, item_count, projects_mentioned, generated_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (reportType) {
    query = query.eq('report_type', reportType)
  }

  const { data, count, error } = await query

  if (error) {
    console.error('Error fetching reports:', error)
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 })
  }

  return NextResponse.json({ reports: data || [], total: count || 0 })
}
