// Data fetchers for digest v2 insight sources
// Container activity, cross-references, and project matches

import { createServiceClient } from '@/lib/supabase'
import type { ContainerActivity, CrossReference, ProjectMatch } from './generator'
import logger from '@/lib/logger'

// Get container activity within the digest window
export async function getContainerActivity(
  userId: string,
  since: Date
): Promise<ContainerActivity[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('container_items')
    .select('container_id, item_id, containers!inner(id, name, item_count, created_at)')
    .gte('added_at', since.toISOString())
    .eq('containers.user_id', userId)

  if (error || !data) {
    logger.error({ err: error, userId }, 'Error fetching container activity')
    return []
  }

  // Group by container
  const containerMap = new Map<string, {
    name: string
    totalItemCount: number
    createdAt: string
    windowItemIds: Set<string>
  }>()

  for (const row of data) {
    const container = row.containers as unknown as {
      id: string; name: string; item_count: number; created_at: string
    }
    if (!containerMap.has(container.id)) {
      containerMap.set(container.id, {
        name: container.name,
        totalItemCount: container.item_count,
        createdAt: container.created_at,
        windowItemIds: new Set(),
      })
    }
    containerMap.get(container.id)!.windowItemIds.add(row.item_id)
  }

  return Array.from(containerMap.entries()).map(([id, info]) => ({
    containerId: id,
    containerName: info.name,
    itemCountInWindow: info.windowItemIds.size,
    totalItemCount: info.totalItemCount,
    isNew: new Date(info.createdAt) >= since,
  }))
}

// Get items that appear in 2+ containers within the digest window
export async function getCrossReferences(
  userId: string,
  since: Date
): Promise<CrossReference[]> {
  const supabase = createServiceClient()

  // Get items in the window
  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('id, title, source_url')
    .eq('user_id', userId)
    .gte('processed_at', since.toISOString())
    .eq('status', 'processed')

  if (itemsError || !items || items.length === 0) {
    return []
  }

  // Get container assignments for those items
  const itemIds = items.map(i => i.id)
  const { data: containerItems, error: ciError } = await supabase
    .from('container_items')
    .select('item_id, containers!inner(name)')
    .in('item_id', itemIds)

  if (ciError || !containerItems) {
    return []
  }

  // Group container names by item
  const itemContainers = new Map<string, string[]>()
  for (const ci of containerItems) {
    const containerName = (ci.containers as unknown as { name: string }).name
    if (!itemContainers.has(ci.item_id)) {
      itemContainers.set(ci.item_id, [])
    }
    itemContainers.get(ci.item_id)!.push(containerName)
  }

  // Filter to items in 2+ containers
  return items
    .filter(item => (itemContainers.get(item.id)?.length ?? 0) >= 2)
    .map(item => ({
      itemId: item.id,
      itemTitle: item.title || 'Untitled',
      sourceUrl: item.source_url,
      containerNames: itemContainers.get(item.id)!,
    }))
}

// Match items to project anchors by tag intersection
export async function getProjectMatches(
  userId: string,
  since: Date
): Promise<ProjectMatch[]> {
  const supabase = createServiceClient()

  // Get active project anchors
  const { data: anchors, error: anchorError } = await supabase
    .from('project_anchors')
    .select('name, description, tags')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (anchorError || !anchors || anchors.length === 0) {
    return []
  }

  // Get items in the window with their tags
  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('id, title, tags')
    .eq('user_id', userId)
    .gte('processed_at', since.toISOString())
    .eq('status', 'processed')

  if (itemsError || !items || items.length === 0) {
    return []
  }

  // Match items to projects by tag intersection
  const results: ProjectMatch[] = []

  for (const anchor of anchors) {
    const projectTags = new Set((anchor.tags || []).map((t: string) => t.toLowerCase()))
    if (projectTags.size === 0) continue

    const matched: ProjectMatch['matchedItems'] = []

    for (const item of items) {
      const itemTags = (item.tags || []).map((t: string) => t.toLowerCase())
      const overlap = itemTags.filter((t: string) => projectTags.has(t))
      if (overlap.length > 0) {
        matched.push({
          itemId: item.id,
          itemTitle: item.title || 'Untitled',
          matchedTags: overlap,
        })
      }
    }

    if (matched.length > 0) {
      results.push({
        projectName: anchor.name,
        projectDescription: anchor.description,
        matchedItems: matched,
      })
    }
  }

  return results
}
