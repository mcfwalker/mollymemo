# Container Merge Logic (MOL-4) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically detect and merge overlapping containers so the library stays organized with fewer, broader collections.

**Architecture:** A `suggestMerges()` function uses GPT-4o mini to evaluate a user's containers for semantic overlap. An `executeMerge()` function moves items from source to target container and deletes the source. A weekly Inngest cron runs both for each user — fully autonomous, no user confirmation needed (design principle: "merge aggressively, split reluctantly").

**Tech Stack:** TypeScript, GPT-4o mini (OpenAI API), Supabase (Postgres), Inngest (cron scheduling), Vitest (testing)

---

### Task 1: Add `suggestMerges()` to containers module

**Files:**
- Modify: `src/lib/containers.ts`
- Test: `src/lib/containers.test.ts` (create)

**Step 1: Write the failing test**

Create `src/lib/containers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('suggestMerges', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    process.env.OPENAI_API_KEY = 'test-api-key'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    vi.restoreAllMocks()
  })

  it('returns merge suggestions for overlapping containers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              merges: [
                { source: 'id-2', target: 'id-1', reason: 'Both cover AI development tools' }
              ]
            })
          }
        }],
        usage: { prompt_tokens: 200, completion_tokens: 50 }
      })
    })

    const { suggestMerges } = await import('./containers')

    const containers = [
      { id: 'id-1', name: 'AI Dev Tools', description: 'Tools for AI development', item_count: 8, items: ['Item A', 'Item B'] },
      { id: 'id-2', name: 'AI Tooling', description: 'AI-powered developer tools', item_count: 3, items: ['Item C'] },
      { id: 'id-3', name: 'Game Design', description: 'Game mechanics and design', item_count: 5, items: ['Item D'] },
    ]

    const result = await suggestMerges(containers)

    expect(result).not.toBeNull()
    expect(result!.merges).toHaveLength(1)
    expect(result!.merges[0]).toEqual({
      source: 'id-2',
      target: 'id-1',
      reason: 'Both cover AI development tools'
    })
  })

  it('returns empty merges when no overlap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: { content: JSON.stringify({ merges: [] }) }
        }],
        usage: { prompt_tokens: 200, completion_tokens: 10 }
      })
    })

    const { suggestMerges } = await import('./containers')

    const containers = [
      { id: 'id-1', name: 'AI Dev Tools', description: 'Tools for AI', item_count: 8, items: ['Item A'] },
      { id: 'id-3', name: 'Game Design', description: 'Game mechanics', item_count: 5, items: ['Item B'] },
    ]

    const result = await suggestMerges(containers)
    expect(result).not.toBeNull()
    expect(result!.merges).toHaveLength(0)
  })

  it('returns null when fewer than 2 containers', async () => {
    const { suggestMerges } = await import('./containers')

    const result = await suggestMerges([
      { id: 'id-1', name: 'Solo', description: null, item_count: 3, items: ['Item A'] }
    ])

    expect(result).toBeNull()
  })

  it('returns null when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY
    const { suggestMerges } = await import('./containers')

    const result = await suggestMerges([
      { id: 'id-1', name: 'A', description: null, item_count: 1, items: [] },
      { id: 'id-2', name: 'B', description: null, item_count: 1, items: [] },
    ])

    expect(result).toBeNull()
  })

  it('validates source/target IDs exist in input', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              merges: [
                { source: 'id-2', target: 'id-1', reason: 'Overlap' },
                { source: 'id-fake', target: 'id-1', reason: 'Hallucinated' }
              ]
            })
          }
        }],
        usage: { prompt_tokens: 200, completion_tokens: 50 }
      })
    })

    const { suggestMerges } = await import('./containers')

    const containers = [
      { id: 'id-1', name: 'A', description: null, item_count: 5, items: ['X'] },
      { id: 'id-2', name: 'B', description: null, item_count: 2, items: ['Y'] },
    ]

    const result = await suggestMerges(containers)
    expect(result!.merges).toHaveLength(1)
    expect(result!.merges[0].source).toBe('id-2')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/containers.test.ts`
Expected: FAIL — `suggestMerges` is not exported

**Step 3: Write the implementation**

Add to `src/lib/containers.ts`:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/containers.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/lib/containers.ts src/lib/containers.test.ts
git commit -m "feat: add suggestMerges() for container overlap detection (MOL-4)"
```

---

### Task 2: Add `executeMerge()` to containers module

**Files:**
- Modify: `src/lib/containers.ts`
- Modify: `src/lib/containers.test.ts`

**Step 1: Write the failing test**

Add to `src/lib/containers.test.ts`:

```typescript
describe('executeMerge', () => {
  it('moves items from source to target and deletes source', async () => {
    // Mock supabase client with chained query builder
    const mockFrom = vi.fn()
    const supabase = { from: mockFrom } as any

    // Mock: get source container items
    mockFrom.mockImplementation((table: string) => {
      if (table === 'container_items') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { item_id: 'item-1' },
                { item_id: 'item-2' },
              ],
              error: null,
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      if (table === 'containers') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {}
    })

    const { executeMerge } = await import('./containers')

    const result = await executeMerge(supabase, {
      source: 'source-id',
      target: 'target-id',
      reason: 'Overlap detected',
    })

    expect(result.itemsMoved).toBe(2)
    expect(result.success).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/containers.test.ts`
Expected: FAIL — `executeMerge` is not exported

**Step 3: Write the implementation**

Add to `src/lib/containers.ts`:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/containers.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/lib/containers.ts src/lib/containers.test.ts
git commit -m "feat: add executeMerge() for container consolidation (MOL-4)"
```

---

### Task 3: Create weekly Inngest merge cron

**Files:**
- Create: `src/inngest/functions/merge-containers.ts`
- Modify: `src/inngest/functions/index.ts`

**Step 1: Write the cron function**

Create `src/inngest/functions/merge-containers.ts`:

```typescript
// Weekly container merge cron — detects and auto-merges overlapping containers

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase";
import { suggestMerges, executeMerge } from "@/lib/containers";

export const mergeContainers = inngest.createFunction(
  {
    id: "merge-containers",
    retries: 1,
  },
  { cron: "0 3 * * 0" }, // Every Sunday at 3am UTC
  async ({ step }) => {
    const supabase = createServiceClient();

    // Step 1: Get all users who have containers
    const users = await step.run("get-users-with-containers", async () => {
      const { data } = await supabase
        .from("containers")
        .select("user_id")
        .order("user_id");

      // Deduplicate user IDs
      const uniqueUserIds = [...new Set(data?.map((c) => c.user_id) || [])];
      return uniqueUserIds;
    });

    let totalMerges = 0;

    for (const userId of users) {
      // Step 2: Fetch containers with sample item titles for context
      const candidates = await step.run(`fetch-containers-${userId}`, async () => {
        const { data: containers } = await supabase
          .from("containers")
          .select("id, name, description, item_count")
          .eq("user_id", userId)
          .order("item_count", { ascending: false });

        if (!containers || containers.length < 2) return null;

        // Fetch sample item titles for each container (max 5 per container)
        const candidates = [];
        for (const container of containers) {
          const { data: items } = await supabase
            .from("container_items")
            .select("item_id")
            .eq("container_id", container.id)
            .limit(5);

          let itemTitles: string[] = [];
          if (items && items.length > 0) {
            const { data: itemData } = await supabase
              .from("items")
              .select("title")
              .in("id", items.map((i) => i.item_id));

            itemTitles = itemData?.map((i) => i.title).filter(Boolean) as string[] || [];
          }

          candidates.push({
            id: container.id,
            name: container.name,
            description: container.description,
            item_count: container.item_count,
            items: itemTitles,
          });
        }

        return candidates;
      });

      if (!candidates) continue;

      // Step 3: Get merge suggestions from LLM
      const suggestions = await step.run(`suggest-merges-${userId}`, async () => {
        return await suggestMerges(candidates);
      });

      if (!suggestions || suggestions.merges.length === 0) continue;

      // Step 4: Execute each merge
      for (const merge of suggestions.merges) {
        const result = await step.run(`execute-merge-${userId}-${merge.source}`, async () => {
          return await executeMerge(supabase, merge);
        });

        if (result.success) {
          totalMerges++;
          console.log(`Merged for user ${userId}: ${merge.reason} (${result.itemsMoved} items moved)`);
        }
      }
    }

    return { usersProcessed: users.length, mergesExecuted: totalMerges };
  }
);
```

**Step 2: Register in index**

In `src/inngest/functions/index.ts`, add:

```typescript
import { mergeContainers } from "./merge-containers";

export const functions = [processItem, discoverContent, mergeContainers];
```

**Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/inngest/functions/merge-containers.ts src/inngest/functions/index.ts
git commit -m "feat: add weekly container merge cron (MOL-4)"
```

---

### Task 4: Run full test suite and verify build

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (existing + new containers tests)

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no type errors

**Step 3: Final commit if any fixes were needed**

Only if tests/build required adjustments.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | `suggestMerges()` + tests | `src/lib/containers.ts`, `src/lib/containers.test.ts` |
| 2 | `executeMerge()` + tests | `src/lib/containers.ts`, `src/lib/containers.test.ts` |
| 3 | Weekly Inngest cron | `src/inngest/functions/merge-containers.ts`, `src/inngest/functions/index.ts` |
| 4 | Full verification | — |

**After completion:** Apply migration to production Supabase if any schema changes needed (none expected — reuses existing `containers` and `container_items` tables). Deploy via `git push` to Vercel.
