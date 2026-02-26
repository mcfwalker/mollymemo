# Trend Reports

**Date:** 2026-02-26
**Status:** Draft
**Feature:** #2
**Theme:** Intelligence & Curation

## Problem

The current voice digest isn't being listened to. MollyMemo captures dozens of links but provides no written analysis of what patterns are emerging, how they connect to active projects, or what proactive suggestions follow from the user's trajectory.

## Approach

Replace the voice digest with a written trend report system powered by Claude Opus. Reports are generated on a fixed weekly cadence: daily reports Tuesday–Sunday, weekly roundup on Monday. All reports are stored in Supabase and rendered in the MollyMemo UI at `/reports`. Email delivery is configurable per-user (daily, weekly, or none).

### Report Types

**Daily Report (T–Su)**
- Analyze items captured in the last 24h
- Identify emerging patterns ("you're gathering a lot of links about X, Y, Z")
- Connect to Sidespace projects at medium depth (project name, stage, recent activity — not individual tickets)
- Proactive suggestions: areas worth exploring based on current trajectory
- Reference specific captured items as evidence

**Weekly Roundup (Monday)**
- Synthesize the week's dailies into a higher-level narrative
- Longer-horizon pattern recognition across the full 7-day window
- Cross-project connections and trajectory shifts
- Can reference the week's daily reports rather than re-analyzing raw items

### Architecture

- **Generation:** Inngest cron triggers daily at configured time (e.g., 6am user timezone)
- **Model:** Claude Opus via Anthropic API (analytical quality matters more than speed/cost)
- **Data sources:** Items (24h or 7d window), Sidespace project anchors + stages, existing trends table, previous reports for continuity
- **Storage:** New `reports` table in Supabase
- **UI:** `/reports` route with report list and detail view
- **Email:** Resend or similar, beautifully formatted HTML email
- **User prefs:** `report_frequency` column on users table (`daily` | `weekly` | `none`)

### Deprecation

Once trend reports are live and verified, deprecate the voice digest cron (`/api/cron/digest`). Keep the code for one release cycle, then remove.

## Data Model

```sql
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
```

User preferences:
```sql
ALTER TABLE users ADD COLUMN report_frequency TEXT DEFAULT 'daily';
-- 'daily' | 'weekly' | 'none'
```

## Nav Update

Update navigation across all pages:
- Home | **Reports** | Containers | Settings | Admin

## Tasks

1. Create `reports` table migration
2. Add `report_frequency` to users table
3. Build report generation Inngest function (daily)
4. Build report generation Inngest function (weekly roundup)
5. Integrate Sidespace project data into report context (via project_anchors + MollyMemo bridge)
6. Create `/reports` page with list view
7. Create report detail view
8. Build email template and delivery via Resend
9. Add report frequency preference to Settings page
10. Update navigation to include Reports link
11. Deprecate voice digest cron
