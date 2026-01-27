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

export interface CurrentMonthStats {
  daysElapsed: number
  entryCount: number
  totalCost: number
  avgCost: number
}

// Get current month statistics for the stats row
export async function getCurrentMonthStats(supabase: ReturnType<typeof createBrowserClient>): Promise<CurrentMonthStats> {
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysElapsed = now.getDate()

  const { data, error } = await supabase
    .from('items')
    .select('openai_cost, grok_cost')
    .gte('captured_at', firstOfMonth.toISOString())
    .not('openai_cost', 'is', null)

  if (error || !data) {
    console.error('Error fetching current month stats:', error)
    return { daysElapsed, entryCount: 0, totalCost: 0, avgCost: 0 }
  }

  // Include items with grok_cost but no openai_cost too
  const { data: grokOnlyData } = await supabase
    .from('items')
    .select('openai_cost, grok_cost')
    .gte('captured_at', firstOfMonth.toISOString())
    .is('openai_cost', null)
    .not('grok_cost', 'is', null)

  const allData = [...data, ...(grokOnlyData || [])]

  const entryCount = allData.length
  const totalCost = allData.reduce((sum, item) => {
    return sum + (item.openai_cost || 0) + (item.grok_cost || 0)
  }, 0)
  const avgCost = entryCount > 0 ? totalCost / entryCount : 0

  return { daysElapsed, entryCount, totalCost, avgCost }
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
