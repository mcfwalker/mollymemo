-- MOL-7: Digest v2 — configurable cadence
-- Add digest_frequency (daily/weekly/never) to replace digest_enabled boolean
-- Add digest_day (0-6, 0=Sunday) for weekly digest scheduling

ALTER TABLE users ADD COLUMN digest_frequency TEXT DEFAULT 'daily';
ALTER TABLE users ADD COLUMN digest_day INTEGER DEFAULT 1;

-- Migrate existing data
UPDATE users SET digest_frequency = 'daily' WHERE digest_enabled = true;
UPDATE users SET digest_frequency = 'never' WHERE digest_enabled = false;

-- Drop old column
ALTER TABLE users DROP COLUMN digest_enabled;
