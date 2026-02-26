-- MOL-16: Add report_frequency column to users table
-- Controls email delivery: 'daily' | 'weekly' | 'none'

ALTER TABLE users ADD COLUMN report_frequency TEXT DEFAULT 'daily';
