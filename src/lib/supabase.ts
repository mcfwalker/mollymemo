import { createClient } from '@supabase/supabase-js'
import { createServerClient as createSSRServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Client for browser (uses anon key) - for client components
export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Client for server with auth session - for route handlers and server components
export async function createServerClient() {
  const cookieStore = await cookies()

  return createSSRServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component - cookies are read-only
          }
        },
      },
    }
  )
}

// Service client for operations that bypass auth (Telegram webhook, background jobs)
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Types for our users table
export interface User {
  id: string
  email: string
  display_name: string | null
  telegram_user_id: number | null
  created_at: string
}

// Types for our items table
export interface Item {
  id: string
  item_number: number
  user_id: string
  source_url: string
  source_type: 'tiktok' | 'github' | 'article' | 'youtube' | 'x'
  title: string | null
  summary: string | null
  transcript: string | null
  extracted_entities: {
    repos?: string[]
    tools?: string[]
    techniques?: string[]
  } | null
  domain: string | null
  content_type: 'repo' | 'technique' | 'tool' | 'resource' | 'person' | null
  tags: string[] | null
  github_url: string | null
  github_metadata: {
    stars?: number
    language?: string
    description?: string
    topics?: string[]
  } | null
  captured_at: string
  processed_at: string | null
  status: 'pending' | 'processing' | 'processed' | 'failed'
  error_message: string | null
  raw_data: Record<string, unknown> | null
  openai_cost: number | null
  grok_cost: number | null
  repo_extraction_cost: number | null
}

// Types for containers
export interface Container {
  id: string
  user_id: string
  name: string
  description: string | null
  item_count: number
  created_at: string
  updated_at: string
}

export interface ContainerItem {
  container_id: string
  item_id: string
  added_at: string
}

// Types for reports
export interface Report {
  id: string
  user_id: string
  report_type: 'daily' | 'weekly'
  title: string
  content: string
  content_html: string | null
  window_start: string
  window_end: string
  item_count: number
  projects_mentioned: { name: string; stage: string | null; relevance: string }[] | null
  generated_at: string
  emailed_at: string | null
  created_at: string
}

// Types for project anchors
export interface ProjectAnchor {
  id: string
  user_id: string
  external_project_id: string
  name: string
  description: string | null
  tags: string[]
  stage: string | null
  source: string
  created_at: string
  updated_at: string
}

// Cost statistics types
export interface MonthStats {
  month: string // ISO date string of first day of month
  entryCount: number
  openaiCost: number
  grokCost: number
  totalCost: number
  avgCost: number
}

export interface AllTimeStats {
  entryCount: number
  totalCost: number
  avgCost: number
}

// Get all-time statistics for the stats row
export async function getAllTimeStats(supabase: ReturnType<typeof createBrowserClient>): Promise<AllTimeStats> {
  // Get all items with any cost
  const { data: itemsData, error: itemsError } = await supabase
    .from('items')
    .select('openai_cost, grok_cost, repo_extraction_cost')
    .or('openai_cost.not.is.null,grok_cost.not.is.null,repo_extraction_cost.not.is.null')

  if (itemsError) {
    console.error('Error fetching item stats:', itemsError)
    return { entryCount: 0, totalCost: 0, avgCost: 0 }
  }

  // Get all digests with costs
  const { data: digestsData, error: digestsError } = await supabase
    .from('digests')
    .select('anthropic_cost, tts_cost')
    .or('anthropic_cost.not.is.null,tts_cost.not.is.null')

  if (digestsError) {
    console.error('Error fetching digest stats:', digestsError)
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

  return { entryCount, totalCost, avgCost }
}

// Get monthly breakdown for the history page
export async function getMonthlyStats(supabase: ReturnType<typeof createBrowserClient>): Promise<MonthStats[]> {
  const { data, error } = await supabase
    .from('items')
    .select('captured_at, openai_cost, grok_cost')
    .or('openai_cost.not.is.null,grok_cost.not.is.null')
    .order('captured_at', { ascending: false })

  if (error || !data) {
    console.error('Error fetching monthly stats:', error)
    return []
  }

  // Group by month
  const monthMap = new Map<string, { items: typeof data }>()

  for (const item of data) {
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

  return stats
}
