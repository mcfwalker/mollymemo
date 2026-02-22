-- Update get_item_project_tags to include color_hue from project_anchors
-- Must DROP first because return type changed (added color_hue column)
DROP FUNCTION IF EXISTS get_item_project_tags(UUID[]);

CREATE OR REPLACE FUNCTION get_item_project_tags(p_item_ids UUID[])
RETURNS TABLE (
  item_id UUID,
  project_name TEXT,
  project_stage TEXT,
  color_hue INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ipr.item_id,
    pa.name as project_name,
    pa.stage as project_stage,
    pa.color_hue
  FROM item_project_relevance ipr
  JOIN project_anchors pa ON pa.id = ipr.project_anchor_id
  WHERE ipr.item_id = ANY(p_item_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION get_item_project_tags TO authenticated;
GRANT EXECUTE ON FUNCTION get_item_project_tags TO service_role;
