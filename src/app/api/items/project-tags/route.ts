import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'
import logger from '@/lib/logger'

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ids = request.nextUrl.searchParams.get('ids')
  if (!ids) {
    return NextResponse.json({ tags: {} })
  }

  const itemIds = ids.split(',').filter(Boolean)
  if (itemIds.length === 0) {
    return NextResponse.json({ tags: {} })
  }

  const supabase = createServiceClient()

  // Verify requested items belong to the authenticated user
  const { data: ownedItems } = await supabase
    .from('items')
    .select('id')
    .eq('user_id', userId)
    .in('id', itemIds)

  const ownedIds = (ownedItems || []).map(i => i.id)
  if (ownedIds.length === 0) {
    return NextResponse.json({ tags: {} })
  }

  const { data, error } = await supabase.rpc('get_item_project_tags', {
    p_item_ids: ownedIds,
  })

  if (error) {
    logger.error({ err: error }, 'Project tags error')
    return NextResponse.json({ error: 'Failed to fetch project tags' }, { status: 500 })
  }

  // Group by item_id for easy frontend consumption
  const tags: Record<string, { project_name: string; color_hue: number | null }[]> = {}
  for (const row of data || []) {
    if (!tags[row.item_id]) {
      tags[row.item_id] = []
    }
    tags[row.item_id].push({
      project_name: row.project_name,
      color_hue: row.color_hue ?? null,
    })
  }

  return NextResponse.json({ tags })
}
