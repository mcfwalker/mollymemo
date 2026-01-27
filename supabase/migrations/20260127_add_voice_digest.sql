-- Voice Digest Feature
-- Adds user preferences and digest storage

-- ============================================
-- USER PREFERENCES
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_time TIME DEFAULT '07:00';
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/Los_Angeles';

-- ============================================
-- DIGESTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  script_text TEXT NOT NULL,
  audio_url TEXT,
  telegram_file_id TEXT,
  item_ids UUID[] NOT NULL,
  item_count INTEGER NOT NULL,
  previous_digest_id UUID REFERENCES digests(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying user's recent digests
CREATE INDEX IF NOT EXISTS idx_digests_user_generated
  ON digests(user_id, generated_at DESC);

-- ============================================
-- RLS FOR DIGESTS
-- ============================================

ALTER TABLE digests ENABLE ROW LEVEL SECURITY;

-- Users can view their own digests
CREATE POLICY "Users can view own digests" ON digests
  FOR SELECT USING (auth.uid() = user_id);

-- Service role inserts digests (bypasses RLS with service key)
