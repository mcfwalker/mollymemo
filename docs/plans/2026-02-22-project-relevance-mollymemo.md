# Project Relevance Tags: MollyMemo Side

**Date:** 2026-02-22
**Status:** Design
**PRD:** Sidespace `PRD_MEMORY_SYSTEM.md` Section 4.6, Pipeline 10
**Companion doc:** Sidespace repo `docs/plans/2026-02-22-mollymemo-writeback-sidespace.md`

---

## Context

MollyMemo captures items (articles, tools, repos) that users save from their phones. Sidespace's Umbra agent scans these items for project relevance, and Hoshi reviews/promotes the best ones. But the relevance signal is locked in Sidespace — when users open MollyMemo's webapp, their items appear unconnected to projects.

This feature closes the feedback loop: after Sidespace promotes a finding, it writes a lightweight project relevance tag back to MollyMemo. The webapp then shows which projects each item is relevant to.

### How it works today

```
project_anchors (already exists)
├── Sidespace pushes project metadata to MollyMemo
├── Columns: external_project_id, name, description, tags, stage
└── Used by: Umbra (to scope research), MollyMemo (future: filing hints)
```

### What this feature adds

```
item_project_relevance (NEW)
├── Links items to project_anchors
├── Written by: Sidespace's hoshi-review (after promoting a finding)
├── Read by: MollyMemo webapp (display project tags on items)
└── Columns: item_id, project_anchor_id, tagged_by, created_at
```

## Database Schema

### New table: `item_project_relevance`

```sql
CREATE TABLE IF NOT EXISTS item_project_relevance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  project_anchor_id UUID NOT NULL REFERENCES project_anchors(id) ON DELETE CASCADE,
  tagged_by TEXT NOT NULL DEFAULT 'hoshi',    -- 'hoshi' (automated) or 'user' (future manual)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(item_id, project_anchor_id)         -- one tag per item-project pair
);

-- Indexes
CREATE INDEX idx_ipr_item_id ON item_project_relevance(item_id);
CREATE INDEX idx_ipr_project_anchor_id ON item_project_relevance(project_anchor_id);

-- RLS
ALTER TABLE item_project_relevance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own item relevance" ON item_project_relevance
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM items WHERE items.id = item_project_relevance.item_id AND items.user_id = auth.uid())
  );

CREATE POLICY "Service role full access" ON item_project_relevance
  FOR ALL USING (true);
```

### New RPC: `upsert_item_project_relevance`

Called by Sidespace's `hoshi-review` after promotion. Batch upsert, idempotent.

```sql
CREATE OR REPLACE FUNCTION upsert_item_project_relevance(
  p_item_ids UUID[],
  p_project_anchor_id UUID,    -- this is the external_project_id from Sidespace
  p_tagged_by TEXT DEFAULT 'hoshi'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_anchor_id UUID;
BEGIN
  -- Resolve external_project_id to internal project_anchor id
  SELECT id INTO v_anchor_id
  FROM project_anchors
  WHERE external_project_id = p_project_anchor_id
  LIMIT 1;

  IF v_anchor_id IS NULL THEN
    RAISE WARNING 'No project anchor found for external_project_id %', p_project_anchor_id;
    RETURN;
  END IF;

  -- Batch upsert — skip conflicts (idempotent)
  INSERT INTO item_project_relevance (item_id, project_anchor_id, tagged_by)
  SELECT unnest(p_item_ids), v_anchor_id, p_tagged_by
  ON CONFLICT (item_id, project_anchor_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_item_project_relevance TO service_role;
```

**Design decisions:**
- **`external_project_id` resolution:** Sidespace passes its `projects.id`. The RPC resolves to MollyMemo's internal `project_anchors.id`. This keeps the caller simple.
- **`ON CONFLICT DO NOTHING`:** Idempotent — re-running a review doesn't create duplicates.
- **`SECURITY DEFINER`:** Runs with elevated privileges since caller is service role from Sidespace.
- **No `confidence` column:** Simplicity. The tag is binary (relevant or not). Confidence lives in Sidespace's `umbra_findings` for those who want it.

## Webapp Changes

### Item list view — project badges

Each item in the list shows small project tag badges below its title/domain.

```
┌─────────────────────────────────────────────┐
│ Tauri Architecture Overview                  │
│ tauri.app · 2d ago                          │
│ [sidespace] [workshop]                      │  ← NEW: project badges
│ Understanding Tauri's webview + Rust...     │
└─────────────────────────────────────────────┘
```

**Data loading:** When fetching items, join through `item_project_relevance` → `project_anchors` to get project names. Could be:
- Eager: join in the items query (adds slight overhead to every load)
- Lazy: separate batch query after items load (better for pagination)

Recommend **lazy batch** via `get_item_project_tags(item_ids UUID[])` RPC for pagination friendliness.

### Filter by project

Add a project filter dropdown to the items view. When a project is selected, only show items with a relevance tag for that project.

```sql
-- Filter items by project relevance
SELECT i.*
FROM items i
JOIN item_project_relevance ipr ON ipr.item_id = i.id
JOIN project_anchors pa ON pa.id = ipr.project_anchor_id
WHERE pa.name = 'sidespace'
ORDER BY i.captured_at DESC;
```

### Helper RPC: `get_item_project_tags`

Batch lookup for webapp display — given a set of item IDs, return their project tags.

```sql
CREATE OR REPLACE FUNCTION get_item_project_tags(p_item_ids UUID[])
RETURNS TABLE (
  item_id UUID,
  project_name TEXT,
  project_stage TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ipr.item_id,
    pa.name as project_name,
    pa.stage as project_stage
  FROM item_project_relevance ipr
  JOIN project_anchors pa ON pa.id = ipr.project_anchor_id
  WHERE ipr.item_id = ANY(p_item_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION get_item_project_tags TO authenticated;
GRANT EXECUTE ON FUNCTION get_item_project_tags TO service_role;
```

## Tasks

### MOL-11: `item_project_relevance` table + upsert RPC

- Create migration with table, indexes, RLS policies
- Create `upsert_item_project_relevance` RPC
- Create `get_item_project_tags` RPC
- Deploy migration
- **No frontend dependency — Sidespace can start writing tags immediately**

### MOL-12: Webapp project tags display

- Fetch project tags for visible items (lazy batch via RPC)
- Render project badges on item cards
- Add project filter dropdown to items view
- **Blocked by:** MOL-11

### MOL-13: Backfill existing promoted findings (optional)

Sidespace has promoted findings in `umbra_findings` with `source_item_id` values. A one-time script could backfill `item_project_relevance` for historical promotions.

```sql
-- Run on Sidespace DB, write to MollyMemo
-- (Script, not migration — runs once)
SELECT source_item_id, project_id
FROM umbra_findings
WHERE status = 'promoted'
  AND source_item_id IS NOT NULL;
```

Then for each, call `upsert_item_project_relevance` on MollyMemo.

**Blocked by:** MOL-11 + SID-108

## Sequencing

```
MOL-11 (table + RPCs)
  ↓
SID-108 (hoshi-review write-back)  ←  can start in parallel, but testing needs MOL-10
  ↓
MOL-11 (webapp display)  ←  can start in parallel with SID-108
  ↓
MOL-12 (backfill)  ←  last, after both sides are working
```

**Critical path:** MOL-11 → SID-108 → test end-to-end → MOL-12

## Future Extensions

- **Manual tagging:** User clicks "tag to project" in MollyMemo webapp → writes to same table with `tagged_by: 'user'`
- **Auto-tag on capture:** When a new item arrives, check against project anchors for obvious matches (keyword overlap with project description/tags) — lightweight, no LLM needed
- **Cross-item connections:** Use `item_project_relevance` as a signal for item-to-item similarity (items tagged to the same project are related)
