-- Add cost tracking columns for repo extraction and digest generation

-- Add repo extraction cost to items
ALTER TABLE items ADD COLUMN IF NOT EXISTS repo_extraction_cost NUMERIC(10, 6);

-- Add Anthropic and TTS costs to digests
ALTER TABLE digests ADD COLUMN IF NOT EXISTS anthropic_cost NUMERIC(10, 6);
ALTER TABLE digests ADD COLUMN IF NOT EXISTS tts_cost NUMERIC(10, 6);

COMMENT ON COLUMN items.repo_extraction_cost IS 'Cost of GPT-4o-mini calls for repo extraction from transcript';
COMMENT ON COLUMN digests.anthropic_cost IS 'Cost of Claude calls for script generation and context updates';
COMMENT ON COLUMN digests.tts_cost IS 'Cost of OpenAI TTS for audio generation';
