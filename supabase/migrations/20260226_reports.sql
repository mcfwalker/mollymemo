-- MOL-15: Create reports table for trend report storage
-- Replaces voice digest with written Opus-powered trend analysis

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,            -- 'daily' | 'weekly'
  title TEXT NOT NULL,                  -- AI-generated title
  content TEXT NOT NULL,                -- Full report content (markdown)
  content_html TEXT,                    -- Pre-rendered HTML for email
  window_start TIMESTAMPTZ NOT NULL,    -- Analysis window start
  window_end TIMESTAMPTZ NOT NULL,      -- Analysis window end
  item_count INTEGER DEFAULT 0,         -- Items analyzed
  projects_mentioned JSONB,             -- [{name, stage, relevance}]
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  emailed_at TIMESTAMPTZ,              -- NULL if not emailed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_user_type ON reports(user_id, report_type, generated_at DESC);

-- RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports"
ON reports
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports"
ON reports
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
ON reports
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports"
ON reports
FOR DELETE
USING (auth.uid() = user_id);
