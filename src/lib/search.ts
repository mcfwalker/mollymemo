// Semantic search using pgvector

import { createClient } from '@supabase/supabase-js'
import { generateEmbedding } from './embeddings'
import logger from '@/lib/logger'

export interface SearchResult {
  id: string
  title: string | null
  summary: string | null
  domain: string | null
  content_type: string | null
  tags: string[] | null
  github_url: string | null
  source_url: string
  similarity: number
}

export interface SearchOptions {
  userId: string
  limit?: number
  threshold?: number // minimum similarity (0-1)
  containerId?: string // restrict results to a specific container
}

export interface ContainerEnrichment {
  item_id: string
  container_id: string
  container_name: string
}

/**
 * Create a Supabase client for search operations
 */
function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Search items semantically by natural language query
 * Uses the match_items RPC function with pgvector
 */
export async function semanticSearch(
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  const { userId, limit = 10, threshold = 0.5, containerId } = options

  // Generate embedding for the query
  const embeddingResult = await generateEmbedding(query)
  if (!embeddingResult) {
    logger.error('Failed to generate query embedding')
    return []
  }

  const supabase = getSupabaseClient()

  // Use match_items_v2 when container filter is set, otherwise original match_items
  const rpcParams: Record<string, unknown> = {
    query_embedding: embeddingResult.embedding,
    match_user_id: userId,
    match_threshold: threshold,
    match_count: limit,
  }

  let rpcName = 'match_items'
  if (containerId) {
    rpcName = 'match_items_v2'
    rpcParams.match_container_id = containerId
  }

  const { data, error } = await supabase.rpc(rpcName, rpcParams)

  if (error) {
    logger.error({ err: error }, 'Semantic search error')
    return []
  }

  return (data || []) as SearchResult[]
}

/**
 * Keyword search fallback using ILIKE
 */
export async function keywordSearch(
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  const { userId, limit = 10, containerId } = options
  const supabase = getSupabaseClient()

  // If container filter, get item IDs first
  let itemIds: string[] | null = null
  if (containerId) {
    const { data: containerItems } = await supabase
      .from('container_items')
      .select('item_id')
      .eq('container_id', containerId)

    itemIds = (containerItems || []).map(ci => ci.item_id)
    if (itemIds.length === 0) return []
  }

  let q = supabase
    .from('items')
    .select('id, title, summary, domain, content_type, tags, github_url, source_url')
    .eq('user_id', userId)
    .eq('status', 'processed')
    .or(`title.ilike.%${query}%,summary.ilike.%${query}%`)
    .limit(limit)

  if (itemIds) {
    q = q.in('id', itemIds)
  }

  const { data, error } = await q

  if (error) {
    logger.error({ err: error }, 'Keyword search error')
    return []
  }

  // Add default similarity score for keyword matches
  return (data || []).map(item => ({
    ...item,
    similarity: 0.5,
  }))
}

/**
 * Hybrid search: semantic first, fallback to keyword
 */
export async function hybridSearch(
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  // Try semantic search first
  const semanticResults = await semanticSearch(query, options)

  if (semanticResults.length > 0) {
    return semanticResults
  }

  // Fallback to keyword search
  return keywordSearch(query, options)
}

/**
 * Batch-enrich search results with container memberships via RPC
 */
export async function enrichWithContainers(
  itemIds: string[]
): Promise<ContainerEnrichment[]> {
  if (itemIds.length === 0) return []

  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc('get_item_containers', {
    item_ids: itemIds,
  })

  if (error) {
    logger.error({ err: error }, 'Container enrichment error')
    return []
  }

  return (data || []) as ContainerEnrichment[]
}
