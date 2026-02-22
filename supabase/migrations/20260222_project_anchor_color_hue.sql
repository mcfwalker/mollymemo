-- Add color_hue to project_anchors so MollyMemo can color-code tags
-- to match Sidespace project colors. Integer 0-359 (HSL hue).

ALTER TABLE project_anchors ADD COLUMN IF NOT EXISTS color_hue INTEGER;
