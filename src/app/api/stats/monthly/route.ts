/**
 * Monthly Stats API Route
 *
 * Returns cost statistics broken down by month for the authenticated user.
 * Used for the stats history page.
 *
 * GET /api/stats/monthly - Get month-by-month cost breakdown
 *
 * @returns MonthStats[] - Array sorted by month descending
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'
import { MonthStats } from '@/lib/supabase'
import logger from '@/lib/logger'

/**
 * Get monthly cost breakdown for the current user.
 *
 * @param request - Contains auth header
 * @returns Array of { month, entryCount, openaiCost, grokCost, totalCost, avgCost }
 */
export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('items')
    .select('captured_at, openai_cost, grok_cost')
    .eq('user_id', userId)
    .or('openai_cost.not.is.null,grok_cost.not.is.null')
    .order('captured_at', { ascending: false })

  if (error) {
    logger.error({ err: error }, 'Error fetching monthly stats')
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }

  // Group by month
  const monthMap = new Map<string, { items: typeof data }>()

  for (const item of data || []) {
    const date = new Date(item.captured_at)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`

    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { items: [] })
    }
    monthMap.get(monthKey)!.items.push(item)
  }

  // Calculate stats for each month
  const stats: MonthStats[] = []
  for (const [month, { items }] of monthMap) {
    const entryCount = items.length
    const openaiCost = items.reduce((sum, item) => sum + (item.openai_cost || 0), 0)
    const grokCost = items.reduce((sum, item) => sum + (item.grok_cost || 0), 0)
    const totalCost = openaiCost + grokCost
    const avgCost = entryCount > 0 ? totalCost / entryCount : 0

    stats.push({ month, entryCount, openaiCost, grokCost, totalCost, avgCost })
  }

  // Sort by month descending
  stats.sort((a, b) => b.month.localeCompare(a.month))

  return NextResponse.json(stats)
}
