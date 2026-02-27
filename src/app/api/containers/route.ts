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
    .from('containers')
    .select('*')
    .eq('user_id', userId)
    .order('item_count', { ascending: false })

  if (error) {
    logger.error({ err: error }, 'Containers fetch error')
    return NextResponse.json({ error: 'Failed to fetch containers' }, { status: 500 })
  }

  return NextResponse.json({ containers: data || [] })
}
