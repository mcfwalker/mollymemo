# Daily Voice Digest

**Status:** Proposed
**Created:** 2026-01-27

## Overview

Deliver a 5-7 minute voice message each morning summarizing the previous day's captured items. Targets users who want value from their knowledge base without accessing Claude Code or the web interface.

## Problem

Non-technical users (e.g., Brandon) capture links and content via Telegram but have no convenient way to consume the processed intelligence. They need a passive, delightful experience that surfaces what they've saved.

## Solution

A scheduled daily digest delivered as a Telegram voice message. The system:
1. Queries items processed in the last 24 hours for each user
2. Generates a script organized by category
3. Converts to speech via TTS
4. Sends as Telegram voice message

## Detailed Design

### Scheduling

- **Trigger:** Vercel cron job
- **Frequency:** Daily, early morning
- **Timezone:** Per-user preference (stored in `users` table)
- **Default time:** 7:00 AM user local time

### Content Generation

**Query:** All items where `user_id = ?` and `processed_at >= NOW() - INTERVAL '24 hours'`

**Script structure:**
```
1. Greeting (time-aware: "Good morning...")
2. Overview ("Yesterday you saved X items across Y categories...")
3. Category blocks (ordered by item count, descending)
   - Category header
   - 2-3 sentence summary per item
   - Key insights or quotes extracted
4. Closing ("That's your digest for today. Have a great day!")
```

**Tone:** Helpful assistant. Casual and friendly without being flippant. Professional but not stiff. Think "competent coworker giving you a briefing."

**Target length:** 700-1000 words (~5-7 min at 140 wpm)

**Empty days:** Send brief message: "Good morning! Nothing new came in yesterday. Have a great day!"

### Text-to-Speech

**Primary option:** OpenAI TTS API
- Model: `tts-1` (or `tts-1-hd` for higher quality)
- Voice: `nova` or `onyx` (test both for tone fit)
- Format: `opus` (Telegram-native, good compression)

**Alternative:** ElevenLabs (if more natural voice needed)

### Delivery

**Channel:** Telegram voice message
- Uses existing bot infrastructure
- Same channel users capture from (symmetry)
- Voice messages auto-play, feel native

**API:** `sendVoice` endpoint with `.ogg` opus file

### Data Model Changes

```sql
-- User preferences
ALTER TABLE users ADD COLUMN digest_enabled BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN digest_time TIME DEFAULT '07:00';
ALTER TABLE users ADD COLUMN timezone VARCHAR(50) DEFAULT 'America/Los_Angeles';

-- Digest storage
CREATE TABLE digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  script_text TEXT NOT NULL,
  audio_url TEXT,
  item_ids UUID[] NOT NULL,
  feedback JSONB DEFAULT '[]',
  braintrust_span_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own digests" ON digests
  FOR SELECT USING (user_id = auth.uid());
```

### File Structure

```
src/
  lib/
    digest/
      generator.ts    # Script generation (LLM call)
      tts.ts          # Text-to-speech conversion
      scheduler.ts    # User iteration, timezone logic
      braintrust.ts   # Observability logging
  app/
    api/
      cron/
        digest/
          route.ts    # Vercel cron endpoint
    digest/
      [id]/
        page.tsx      # Web player fallback
```

## Cost Estimate

Per user per day (assuming 800 words):
- GPT-4o-mini script generation: ~$0.001
- OpenAI TTS (800 words ≈ 5000 chars): ~$0.075

**Monthly per active user:** ~$2.30

## Security Considerations

- Cron endpoint must verify Vercel cron secret header
- Audio files stored in Supabase Storage with RLS (user's own digests only)
- Web player URLs use UUID - not guessable, but add auth check
- User timezone is low-sensitivity PII but treat appropriately

### Feedback Collection

**Mantra:** Zero-friction for the user.

Users can reply to the digest voice message with:
- Voice reply → transcribed and stored as feedback
- Text reply → stored directly as feedback

Feedback is tagged to the specific digest and stored for quality improvement. No UI required - just reply naturally in Telegram.

### Web Player Fallback

Each digest gets a unique URL: `https://lazylist.mcfw.io/digest/{digest_id}`

- Displays transcript alongside audio player
- Useful for users who want to read instead of listen
- Link included in Telegram message (optional, unobtrusive)

### Script Storage & Observability

All generated scripts stored in `digests` table:
- `user_id`, `generated_at`, `script_text`, `audio_url`
- `item_ids` (array of items included)
- `feedback` (user replies)

**Braintrust Integration:** Use [Braintrust](https://www.braintrust.dev/) for LLM observability:
- Log all script generation calls
- Track quality scores over time
- A/B test prompt variations
- Monitor cost and latency

```
src/
  lib/
    digest/
      braintrust.ts   # Braintrust logging wrapper
```

## Out of Scope (v1)

- Opt-in/opt-out UI (all users receive by default)
- Custom delivery time selection UI
- Multiple digest frequencies (weekly, etc.)
- Transcript alongside audio

## Implementation Plan

1. **Database migration** - User preferences + digests table + RLS
2. **Braintrust setup** - Initialize project, add SDK
3. **Script generator** - LLM prompt + category organization + Braintrust logging
4. **TTS integration** - OpenAI API wrapper, audio storage
5. **Telegram voice delivery** - Extend bot to send voice messages
6. **Feedback handler** - Capture replies to digest messages
7. **Web player** - `/digest/[id]` page with transcript + audio
8. **Cron endpoint** - Vercel scheduled function
9. **Testing** - Manual test with Brandon's account

## Success Metrics

- Delivery success rate > 99%
- Audio generation latency < 30s
- User engagement (do they keep listening day over day?)
