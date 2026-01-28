import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Get all items with any cost (all-time)
  const { data: itemsData, error: itemsError } = await supabase
    .from('items')
    .select('openai_cost, grok_cost, repo_extraction_cost')
    .eq('user_id', userId)
    .or('openai_cost.not.is.null,grok_cost.not.is.null,repo_extraction_cost.not.is.null')

  if (itemsError) {
    console.error('Error fetching item stats:', itemsError)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }

  // Get all digests with costs (all-time)
  const { data: digestsData, error: digestsError } = await supabase
    .from('digests')
    .select('anthropic_cost, tts_cost')
    .eq('user_id', userId)
    .or('anthropic_cost.not.is.null,tts_cost.not.is.null')

  if (digestsError) {
    console.error('Error fetching digest stats:', digestsError)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }

  const items = itemsData || []
  const digests = digestsData || []

  const entryCount = items.length
  const itemCost = items.reduce((sum, item) => {
    return sum + (item.openai_cost || 0) + (item.grok_cost || 0) + (item.repo_extraction_cost || 0)
  }, 0)
  const digestCost = digests.reduce((sum, digest) => {
    return sum + (digest.anthropic_cost || 0) + (digest.tts_cost || 0)
  }, 0)
  const totalCost = itemCost + digestCost
  const avgCost = entryCount > 0 ? itemCost / entryCount : 0

  return NextResponse.json({
    entryCount,
    totalCost,
    avgCost,
  })
}
