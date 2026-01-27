import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysElapsed = now.getDate()

  // Get items with costs for current month
  const { data, error } = await supabase
    .from('items')
    .select('openai_cost, grok_cost')
    .eq('user_id', userId)
    .gte('captured_at', firstOfMonth.toISOString())
    .or('openai_cost.not.is.null,grok_cost.not.is.null')

  if (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }

  const allData = data || []
  const entryCount = allData.length
  const totalCost = allData.reduce((sum, item) => {
    return sum + (item.openai_cost || 0) + (item.grok_cost || 0)
  }, 0)
  const avgCost = entryCount > 0 ? totalCost / entryCount : 0

  return NextResponse.json({
    daysElapsed,
    entryCount,
    totalCost,
    avgCost,
  })
}
