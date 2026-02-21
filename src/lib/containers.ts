// Container assignment engine — auto-files items into containers using GPT-4o mini

import { createServiceClient } from '@/lib/supabase'

// OpenAI pricing for gpt-4o-mini
const OPENAI_INPUT_PRICE = 0.15 / 1_000_000
const OPENAI_OUTPUT_PRICE = 0.60 / 1_000_000

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
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured')
    return null
  }

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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 300,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`OpenAI API error: ${response.status}`, error)
      return null
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content

    if (!text) {
      console.error('No response from OpenAI for container assignment')
      return null
    }

    // Calculate cost
    const usage = data.usage || {}
    const cost = (usage.prompt_tokens || 0) * OPENAI_INPUT_PRICE +
                 (usage.completion_tokens || 0) * OPENAI_OUTPUT_PRICE

    // Parse JSON (handle markdown code blocks)
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

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

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured')
    return null
  }

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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`OpenAI API error: ${response.status}`, error)
      return null
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content

    if (!text) {
      console.error('No response from OpenAI for merge suggestions')
      return null
    }

    const usage = data.usage || {}
    const cost = (usage.prompt_tokens || 0) * OPENAI_INPUT_PRICE +
                 (usage.completion_tokens || 0) * OPENAI_OUTPUT_PRICE

    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

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
