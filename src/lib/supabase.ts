import { createClient } from '@supabase/supabase-js'

// Client for browser (uses anon key)
export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Client for server (uses service role key for full access)
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Types for our items table
export interface Item {
  id: string
  item_number: number
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
}
