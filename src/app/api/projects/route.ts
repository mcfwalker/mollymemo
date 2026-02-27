import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'
import logger from '@/lib/logger'

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('project_anchors')
    .select('id, name, stage')
    .eq('user_id', userId)
    .order('name', { ascending: true })

  if (error) {
    logger.error({ err: error }, 'Projects list error')
    return NextResponse.json({ error: 'Failed to list projects' }, { status: 500 })
  }

  return NextResponse.json({ projects: data || [] })
}
