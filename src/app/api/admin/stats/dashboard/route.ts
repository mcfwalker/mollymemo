/**
 * Admin Cost Dashboard API Route
 *
 * Returns comprehensive cost statistics across ALL users for admin decision-making.
 * Protected by admin middleware - only users with is_admin=true can access.
 *
 * GET /api/admin/stats/dashboard - Get full admin cost dashboard data
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import logger from '@/lib/logger'

interface ItemRow {
  user_id: string
  captured_at: string
  source_type: string
  openai_cost: number | null
  grok_cost: number | null
  repo_extraction_cost: number | null
}

interface DigestRow {
  user_id: string
  generated_at: string
  anthropic_cost: number | null
  tts_cost: number | null
}

interface UserRow {
  id: string
  email: string
  display_name: string | null
}

interface OperationCost {
  operation: string
  cost: number
  percentage: number
}

interface SourceCost {
  source: string
  count: number
  cost: number
  avgCost: number
}

interface UserCost {
  id: string
  email: string
  displayName: string | null
  itemCount: number
  digestCount: number
  itemCost: number
  digestCost: number
  totalCost: number
}

interface MonthData {
  month: string
  itemCount: number
  digestCount: number
  openaiCost: number
  grokCost: number
  repoExtractionCost: number
  anthropicCost: number
  ttsCost: number
  totalCost: number
}

export async function GET() {
  const supabase = createServiceClient()

  // Fetch all users
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, display_name')

  if (usersError) {
    logger.error({ err: usersError }, 'Error fetching users')
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }

  // Fetch all items with costs (across all users)
  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('user_id, captured_at, source_type, openai_cost, grok_cost, repo_extraction_cost')
    .eq('status', 'processed')
    .order('captured_at', { ascending: false })

  if (itemsError) {
    logger.error({ err: itemsError }, 'Error fetching items')
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }

  // Fetch all digests with costs (across all users)
  const { data: digests, error: digestsError } = await supabase
    .from('digests')
    .select('user_id, generated_at, anthropic_cost, tts_cost')
    .order('generated_at', { ascending: false })

  if (digestsError) {
    logger.error({ err: digestsError }, 'Error fetching digests')
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }

  const userRows: UserRow[] = users || []
  const itemRows: ItemRow[] = items || []
  const digestRows: DigestRow[] = digests || []

  // Calculate totals for operation breakdown
  const totals = {
    openai: 0,
    grok: 0,
    repoExtraction: 0,
    anthropic: 0,
    tts: 0,
  }

  for (const item of itemRows) {
    totals.openai += item.openai_cost || 0
    totals.grok += item.grok_cost || 0
    totals.repoExtraction += item.repo_extraction_cost || 0
  }

  for (const digest of digestRows) {
    totals.anthropic += digest.anthropic_cost || 0
    totals.tts += digest.tts_cost || 0
  }

  const grandTotal = totals.openai + totals.grok + totals.repoExtraction + totals.anthropic + totals.tts

  // By Operation breakdown
  const byOperation: OperationCost[] = [
    {
      operation: 'Transcription & Classification',
      cost: totals.openai,
      percentage: grandTotal > 0 ? (totals.openai / grandTotal) * 100 : 0,
    },
    {
      operation: 'X/Twitter (Grok)',
      cost: totals.grok,
      percentage: grandTotal > 0 ? (totals.grok / grandTotal) * 100 : 0,
    },
    {
      operation: 'Repo Extraction',
      cost: totals.repoExtraction,
      percentage: grandTotal > 0 ? (totals.repoExtraction / grandTotal) * 100 : 0,
    },
    {
      operation: 'Digest Generation (Claude)',
      cost: totals.anthropic,
      percentage: grandTotal > 0 ? (totals.anthropic / grandTotal) * 100 : 0,
    },
    {
      operation: 'Text-to-Speech',
      cost: totals.tts,
      percentage: grandTotal > 0 ? (totals.tts / grandTotal) * 100 : 0,
    },
  ].filter(op => op.cost > 0)
   .sort((a, b) => b.cost - a.cost)

  // By Source breakdown
  const sourceMap = new Map<string, { count: number; cost: number }>()
  for (const item of itemRows) {
    const source = item.source_type || 'unknown'
    const itemCost = (item.openai_cost || 0) + (item.grok_cost || 0) + (item.repo_extraction_cost || 0)

    if (!sourceMap.has(source)) {
      sourceMap.set(source, { count: 0, cost: 0 })
    }
    const entry = sourceMap.get(source)!
    entry.count++
    entry.cost += itemCost
  }

  const bySource: SourceCost[] = Array.from(sourceMap.entries())
    .map(([source, data]) => ({
      source,
      count: data.count,
      cost: data.cost,
      avgCost: data.count > 0 ? data.cost / data.count : 0,
    }))
    .sort((a, b) => b.cost - a.cost)

  // By User breakdown
  const userMap = new Map<string, { itemCount: number; digestCount: number; itemCost: number; digestCost: number }>()

  for (const item of itemRows) {
    if (!userMap.has(item.user_id)) {
      userMap.set(item.user_id, { itemCount: 0, digestCount: 0, itemCost: 0, digestCost: 0 })
    }
    const entry = userMap.get(item.user_id)!
    entry.itemCount++
    entry.itemCost += (item.openai_cost || 0) + (item.grok_cost || 0) + (item.repo_extraction_cost || 0)
  }

  for (const digest of digestRows) {
    if (!userMap.has(digest.user_id)) {
      userMap.set(digest.user_id, { itemCount: 0, digestCount: 0, itemCost: 0, digestCost: 0 })
    }
    const entry = userMap.get(digest.user_id)!
    entry.digestCount++
    entry.digestCost += (digest.anthropic_cost || 0) + (digest.tts_cost || 0)
  }

  const byUser: UserCost[] = userRows
    .map(user => {
      const stats = userMap.get(user.id) || { itemCount: 0, digestCount: 0, itemCost: 0, digestCost: 0 }
      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        itemCount: stats.itemCount,
        digestCount: stats.digestCount,
        itemCost: stats.itemCost,
        digestCost: stats.digestCost,
        totalCost: stats.itemCost + stats.digestCost,
      }
    })
    .filter(u => u.itemCount > 0 || u.digestCount > 0)
    .sort((a, b) => b.totalCost - a.totalCost)

  // Monthly breakdown
  const monthMap = new Map<string, MonthData>()

  for (const item of itemRows) {
    const date = new Date(item.captured_at)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        month: monthKey,
        itemCount: 0,
        digestCount: 0,
        openaiCost: 0,
        grokCost: 0,
        repoExtractionCost: 0,
        anthropicCost: 0,
        ttsCost: 0,
        totalCost: 0,
      })
    }

    const entry = monthMap.get(monthKey)!
    entry.itemCount++
    entry.openaiCost += item.openai_cost || 0
    entry.grokCost += item.grok_cost || 0
    entry.repoExtractionCost += item.repo_extraction_cost || 0
  }

  for (const digest of digestRows) {
    const date = new Date(digest.generated_at)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        month: monthKey,
        itemCount: 0,
        digestCount: 0,
        openaiCost: 0,
        grokCost: 0,
        repoExtractionCost: 0,
        anthropicCost: 0,
        ttsCost: 0,
        totalCost: 0,
      })
    }

    const entry = monthMap.get(monthKey)!
    entry.digestCount++
    entry.anthropicCost += digest.anthropic_cost || 0
    entry.ttsCost += digest.tts_cost || 0
  }

  // Calculate totals for each month
  for (const entry of monthMap.values()) {
    entry.totalCost = entry.openaiCost + entry.grokCost + entry.repoExtractionCost + entry.anthropicCost + entry.ttsCost
  }

  const monthly = Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month))

  // Current month stats
  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const currentMonth = monthMap.get(currentMonthKey) || {
    month: currentMonthKey,
    itemCount: 0,
    digestCount: 0,
    openaiCost: 0,
    grokCost: 0,
    repoExtractionCost: 0,
    anthropicCost: 0,
    ttsCost: 0,
    totalCost: 0,
  }

  return NextResponse.json({
    currentMonth: {
      period: currentMonthKey,
      itemCount: currentMonth.itemCount,
      digestCount: currentMonth.digestCount,
      totalCost: currentMonth.totalCost,
      avgCostPerItem: currentMonth.itemCount > 0
        ? (currentMonth.openaiCost + currentMonth.grokCost + currentMonth.repoExtractionCost) / currentMonth.itemCount
        : 0,
      avgCostPerDigest: currentMonth.digestCount > 0
        ? (currentMonth.anthropicCost + currentMonth.ttsCost) / currentMonth.digestCount
        : 0,
    },
    allTime: {
      itemCount: itemRows.length,
      digestCount: digestRows.length,
      totalCost: grandTotal,
    },
    byOperation,
    bySource,
    byUser,
    monthly,
  })
}
