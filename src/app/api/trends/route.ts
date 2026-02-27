// GET /api/trends — returns active trends for a user
// Protected by CRON_SECRET (for Sidespace agent access)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import logger from '@/lib/logger'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const userId = searchParams.get('user_id')

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'user_id query parameter required' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('trends')
    .select('trend_type, title, description, strength, detected_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('strength', { ascending: false })

  if (error) {
    logger.error({ err: error }, 'Error fetching trends')
    return NextResponse.json(
      { error: 'Failed to fetch trends' },
      { status: 500 }
    )
  }

  return NextResponse.json({ trends: data || [] })
}
