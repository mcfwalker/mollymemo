// Container assignment engine — auto-files items into containers using GPT-4o mini

import { createServiceClient } from '@/lib/supabase'
import { chatCompletion, parseJsonResponse } from '@/lib/openai-client'

export interface ContainerAssignment {
  existing: string[]          // IDs of existing containers to file into
  create: NewContainerSpec[]  // New containers to create
  cost: number
}

interface NewContainerSpec {
  name: string
  description: string
}

export interface AssignmentInput {
  title: string
  summary: string | null
  tags: string[] | null
  domain: string | null
  content_type: string | null
}

export interface ExistingContainer {
  id: string
  name: string
  description: string | null
}

export interface ProjectAnchorHint {
  name: string
  description: string | null
  tags: string[]
}

/**
 * Use GPT-4o mini to decide which container(s) an item belongs in.
 * May assign to existing containers, create new ones, or both.
 * Returns null on error (non-fatal — pipeline continues without assignment).
 */
export async function assignContainers(
  item: AssignmentInput,
  containers: ExistingContainer[],
  anchors: ProjectAnchorHint[]
): Promise<ContainerAssignment | null> {
  const containerList = containers.length > 0
    ? containers.map(c => `- [${c.id}]: ${c.name}${c.description ? ` — ${c.description}` : ''}`).join('\n')
    : 'No containers exist yet. You must create at least one.'

  const anchorList = anchors.length > 0
    ? anchors.map(a => `- ${a.name}: ${a.description || 'No description'} (tags: ${a.tags.join(', ') || 'none'})`).join('\n')
    : 'No active projects.'

  const prompt = `You are a personal knowledge organizer. File this item into the right container(s).

ITEM:
- Title: ${item.title}
- Summary: ${item.summary || 'None'}
- Tags: ${item.tags?.join(', ') || 'None'}
- Domain: ${item.domain || 'Unknown'}
- Type: ${item.content_type || 'Unknown'}

EXISTING CONTAINERS:
${containerList}

ACTIVE PROJECTS (context hints — these tell you what topics the user cares about):
${anchorList}

RULES:
1. File into 1-3 existing containers if they fit. Prefer existing containers over creating new ones.
2. Only create a new container if NO existing container is relevant. Be reluctant to create.
3. New container names: 2-4 words, broad enough for 5-20 items (e.g., "AI Dev Tools" not "Cursor Extensions").
4. New container descriptions: one sentence explaining what belongs there.
5. An item can belong to multiple containers if genuinely relevant to each.

Return ONLY valid JSON, no markdown:
{"existing": ["container-id-1"], "create": [{"name": "Name", "description": "Description"}]}

Either array can be empty, but not both.`

  try {
    const completion = await chatCompletion(
      [{ role: 'user', content: prompt }],
      { maxTokens: 300 }
    )
    if (!completion) return null

    const { cost } = completion
    const parsed = parseJsonResponse(completion.text) as Record<string, unknown[]>

    // Validate existing container IDs against known IDs
    const validIds = new Set(containers.map(c => c.id))
    const validExisting = (parsed.existing || []).filter((id: string) => validIds.has(id))

    // Validate new container specs
    const validCreate: NewContainerSpec[] = (parsed.create || [])
      .filter((spec: { name?: string }) => spec.name && spec.name.trim())
      .map((spec: { name: string; description?: string }) => ({
        name: spec.name.trim(),
        description: (spec.description || '').trim(),
      }))

    if (validExisting.length === 0 && validCreate.length === 0) {
      console.warn('Container assignment returned no valid assignments')
      return { existing: [], create: [], cost }
    }

    return { existing: validExisting, create: validCreate, cost }
  } catch (error) {
    console.error('Container assignment error:', error)
    return null
  }
}

/**
 * Apply container assignments to the database.
 * Creates new containers (deduplicating by name), inserts container_items rows.
 * The trg_container_item_count trigger handles item_count sync automatically.
 */
export async function applyContainerAssignment(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  itemId: string,
  assignment: ContainerAssignment
): Promise<{ containerNames: string[] }> {
  const containerNames: string[] = []
  const containerIds: string[] = [...assignment.existing]

  // Resolve names for existing containers
  if (assignment.existing.length > 0) {
    const { data: existingContainers } = await supabase
      .from('containers')
      .select('id, name')
      .in('id', assignment.existing)

    for (const c of existingContainers || []) {
      containerNames.push(c.name)
    }
  }

  // Create new containers (with duplicate name check)
  for (const spec of assignment.create) {
    const { data: existing } = await supabase
      .from('containers')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', spec.name)
      .maybeSingle()

    if (existing) {
      containerIds.push(existing.id)
      containerNames.push(existing.name)
    } else {
      const { data: created, error } = await supabase
        .from('containers')
        .insert({
          user_id: userId,
          name: spec.name,
          description: spec.description || null,
        })
        .select('id, name')
        .single()

      if (error) {
        console.error('Failed to create container:', error)
        continue
      }

      containerIds.push(created.id)
      containerNames.push(created.name)
    }
  }

  // Insert container_items (upsert for Inngest retry safety)
  for (const containerId of containerIds) {
    const { error } = await supabase
      .from('container_items')
      .upsert(
        { container_id: containerId, item_id: itemId },
        { onConflict: 'container_id,item_id' }
      )

    if (error) {
      console.error(`Failed to add item to container ${containerId}:`, error)
    }
  }

  return { containerNames }
}

export interface MergeSuggestion {
  source: string  // container ID to merge FROM (will be deleted)
  target: string  // container ID to merge INTO (will be kept)
  reason: string
}

export interface MergeResult {
  merges: MergeSuggestion[]
  cost: number
}

export interface MergeCandidate {
  id: string
  name: string
  description: string | null
  item_count: number
  items: string[]  // item titles for context
}

/**
 * Use GPT-4o mini to identify containers that should be merged.
 * Prefers merging smaller containers into larger ones.
 * Returns null if < 2 containers or on error.
 */
export async function suggestMerges(
  containers: MergeCandidate[]
): Promise<MergeResult | null> {
  if (containers.length < 2) return null

  const containerList = containers
    .map(c => `- [${c.id}] "${c.name}" (${c.item_count} items): ${c.description || 'No description'}. Sample items: ${c.items.slice(0, 5).join(', ') || 'none'}`)
    .join('\n')

  const prompt = `You are a personal knowledge librarian. Review these containers and identify any that should be merged because they cover the same or very similar topics.

CONTAINERS:
${containerList}

RULES:
1. Merge aggressively — if two containers cover substantially the same topic, merge them.
2. Always merge the SMALLER container (fewer items) into the LARGER one.
3. Only suggest merges where there is clear semantic overlap. "AI Dev Tools" and "AI Tooling" should merge. "AI Dev Tools" and "Game Design" should not.
4. A container can only appear once as a source (it can only be merged into one target).
5. If no merges are needed, return an empty array.

Return ONLY valid JSON, no markdown:
{"merges": [{"source": "smaller-container-id", "target": "larger-container-id", "reason": "brief explanation"}]}`

  try {
    const completion = await chatCompletion(
      [{ role: 'user', content: prompt }],
      { temperature: 0.1 }
    )
    if (!completion) return null

    const { cost } = completion
    const parsed = parseJsonResponse(completion.text) as Record<string, unknown[]>

    // Validate IDs exist in input
    const validIds = new Set(containers.map(c => c.id))
    const usedSources = new Set<string>()

    const validMerges: MergeSuggestion[] = (parsed.merges || [])
      .filter((m: { source?: string; target?: string; reason?: string }) => {
        if (!m.source || !m.target || !m.reason) return false
        if (!validIds.has(m.source) || !validIds.has(m.target)) return false
        if (m.source === m.target) return false
        if (usedSources.has(m.source)) return false
        usedSources.add(m.source)
        return true
      })
      .map((m: { source: string; target: string; reason: string }) => ({
        source: m.source,
        target: m.target,
        reason: m.reason,
      }))

    return { merges: validMerges, cost }
  } catch (error) {
    console.error('Merge suggestion error:', error)
    return null
  }
}

export interface MergeExecution {
  success: boolean
  itemsMoved: number
  error?: string
}

/**
 * Execute a container merge: move all items from source to target, delete source.
 * The trg_container_item_count trigger handles item_count sync automatically.
 */
export async function executeMerge(
  supabase: ReturnType<typeof createServiceClient>,
  merge: MergeSuggestion
): Promise<MergeExecution> {
  try {
    // 1. Get all items in the source container
    const { data: sourceItems, error: fetchError } = await supabase
      .from('container_items')
      .select('item_id')
      .eq('container_id', merge.source)

    if (fetchError) {
      console.error('Failed to fetch source items:', fetchError)
      return { success: false, itemsMoved: 0, error: fetchError.message }
    }

    const itemIds = sourceItems?.map(i => i.item_id) || []

    // 2. Upsert items into target container (dedup via onConflict)
    for (const itemId of itemIds) {
      const { error } = await supabase
        .from('container_items')
        .upsert(
          { container_id: merge.target, item_id: itemId },
          { onConflict: 'container_id,item_id' }
        )

      if (error) {
        console.error(`Failed to move item ${itemId}:`, error)
      }
    }

    // 3. Delete source container (CASCADE deletes its container_items rows,
    //    trigger decrements item_count on target for any dupes that were already there)
    const { error: deleteError } = await supabase
      .from('containers')
      .delete()
      .eq('id', merge.source)

    if (deleteError) {
      console.error('Failed to delete source container:', deleteError)
      return { success: false, itemsMoved: itemIds.length, error: deleteError.message }
    }

    console.log(`Merged container ${merge.source} into ${merge.target}: ${itemIds.length} items moved. Reason: ${merge.reason}`)

    return { success: true, itemsMoved: itemIds.length }
  } catch (error) {
    console.error('Merge execution error:', error)
    return { success: false, itemsMoved: 0, error: String(error) }
  }
}
