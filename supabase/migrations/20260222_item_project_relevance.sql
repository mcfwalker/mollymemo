-- Item-project relevance tags: links items to project_anchors
-- Written by Sidespace hoshi-review after promoting a finding
-- Read by MollyMemo webapp to display project badges on items

-- Table
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

-- RPC: upsert_item_project_relevance
-- Called by Sidespace hoshi-review after promotion. Batch upsert, idempotent.
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

-- RPC: get_item_project_tags
-- Batch lookup for webapp display — given item IDs, return their project tags.
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
