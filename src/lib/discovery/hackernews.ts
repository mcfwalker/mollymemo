// Hacker News search via Algolia API (free, no auth required)

import logger from '@/lib/logger'

export interface HNResult {
  id: string
  title: string
  url: string | null
  hnUrl: string
  points: number
  comments: number
  createdAt: Date
}

export interface HNSearchOptions {
  days?: number      // Look back N days (default: 7)
  minPoints?: number // Minimum points threshold (default: 10)
  limit?: number     // Max results (default: 20)
}

/**
 * Search Hacker News via Algolia API
 */
export async function searchHN(
  query: string,
  options: HNSearchOptions = {}
): Promise<HNResult[]> {
  const { days = 7, minPoints = 10, limit = 20 } = options

  // Calculate timestamp for date filter
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const timestamp = Math.floor(cutoffDate.getTime() / 1000)

  // Build Algolia search URL
  const params = new URLSearchParams({
    query,
    tags: 'story', // Only stories, not comments
    numericFilters: `created_at_i>${timestamp},points>${minPoints}`,
    hitsPerPage: String(limit),
  })

  const url = `https://hn.algolia.com/api/v1/search?${params}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      logger.error({ status: response.status }, 'HN Algolia error')
      return []
    }

    const data = await response.json()

    return (data.hits || []).map((hit: {
      objectID: string
      title: string
      url: string | null
      points: number
      num_comments: number
      created_at: string
    }) => ({
      id: hit.objectID,
      title: hit.title,
      url: hit.url,
      hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points,
      comments: hit.num_comments,
      createdAt: new Date(hit.created_at),
    }))
  } catch (error) {
    logger.error({ err: error }, 'HN search error')
    return []
  }
}

/**
 * Search HN for multiple queries (batch)
 */
export async function searchHNBatch(
  queries: string[],
  options: HNSearchOptions = {}
): Promise<Map<string, HNResult[]>> {
  const results = new Map<string, HNResult[]>()

  // Run searches sequentially to avoid rate limiting
  for (const query of queries) {
    const hits = await searchHN(query, options)
    results.set(query, hits)

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return results
}
