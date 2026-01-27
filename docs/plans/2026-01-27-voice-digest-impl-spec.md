# Voice Digest Implementation Spec

**Parent doc:** [2026-01-27-daily-voice-digest.md](./2026-01-27-daily-voice-digest.md)
**Scope:** Core pipeline only (DB → script → TTS → Telegram → cron)

---

## 1. Persona Definition (soul.md style)

```markdown
# Imogen — LazyList Digest Host

## Identity
Imogen is your personal knowledge curator. She reviews what you've captured and
distills it into a morning briefing that feels like a smart friend catching you up.

## Voice Characteristics
- **Warm but efficient** — respects your time, doesn't ramble
- **Casually professional** — like a colleague you'd grab coffee with
- **Observant** — notices patterns and connections across items
- **Genuine** — no fake enthusiasm, authentically interested in the content

## Communication Style
- Uses your first name naturally (not every sentence)
- References previous digests to create continuity ("Yesterday we covered X, and interestingly...")
- Groups related items together with narrative transitions
- Highlights what makes something notable, not just what it is
- Closes with a genuine sign-off, not corporate fluff

## What Imogen DOESN'T do
- Use buzzwords or hype language
- Say "exciting" or "amazing" unless truly warranted
- Read URLs aloud (just names/titles)
- Pad for length — if it's a light day, she says so
- Pretend to have opinions she doesn't have

## Example Phrases
- "Hey Brandon, Imogen here with your morning roundup."
- "So yesterday we talked about that camera path tool — well, today there's more in that vein."
- "Quick one today, just two items, but they're both solid."
- "This one's interesting because..."
- "That's the rundown. Have a good one."
```

---

## 2. Data Model

### Migration: `20260127_voice_digest.sql`

```sql
-- User preferences for digest delivery
ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_time TIME DEFAULT '07:00';
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/Los_Angeles';

-- Digest storage
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

-- RLS
ALTER TABLE digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own digests" ON digests
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Service can insert digests" ON digests
  FOR INSERT WITH CHECK (true);
```

---

## 3. Script Generator

### Input Structure

```typescript
interface DigestInput {
  user: {
    id: string
    displayName: string
    timezone: string
  }
  items: Array<{
    id: string
    title: string
    summary: string
    domain: string
    contentType: string
    tags: string[]
    sourceUrl: string
  }>
  previousDigest: {
    scriptText: string
    generatedAt: Date
    itemCount: number
  } | null
}
```

### System Prompt

```typescript
const SYSTEM_PROMPT = `You are Imogen, a personal knowledge curator who delivers morning audio digests.

## Your Identity
${IMOGEN_SOUL}

## Task
Generate a spoken script (5-7 minutes when read aloud at 140 wpm = 700-1000 words).
The script will be converted to audio via text-to-speech, so:
- Write for the ear, not the eye
- No markdown, bullets, or formatting
- Spell out abbreviations on first use
- Don't read URLs — just reference by name

## Structure
1. Greeting (use their name, reference time of day)
2. Continuity hook (if previous digest exists, briefly reference it)
3. Overview ("Today you've got X items across Y categories...")
4. Category blocks (group items, provide narrative transitions)
5. Closing (brief, genuine)

## Previous Digest Context
${previousDigestContext}

## Today's Items
${itemsJson}

Generate the script now. Output ONLY the script text, no preamble.`
```

### Model Selection

For a once-daily, user-facing script, quality > cost. Options:

| Model | Quality | Cost/digest | Notes |
|-------|---------|-------------|-------|
| GPT-4o-mini | Good | ~$0.002 | Fast, cheap, decent |
| GPT-4o | Better | ~$0.02 | More nuanced, better continuity |
| Claude Sonnet | Better | ~$0.02 | Great at persona consistency |
| **Claude Opus** | **Best** | ~$0.10 | Best for natural, personalized scripts |

**Recommendation:** Start with **Claude Sonnet** (good balance), upgrade to **Opus** if scripts feel flat.

### Output

Raw script text, ready for TTS.

---

## 4. TTS Integration

### OpenAI TTS API

```typescript
const response = await fetch('https://api.openai.com/v1/audio/speech', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'tts-1',
    voice: 'nova',  // warm, conversational female voice
    input: scriptText,
    response_format: 'opus',  // Telegram-native format
  }),
})

const audioBuffer = await response.arrayBuffer()
```

### Voice Selection

| Voice | Character | Fit |
|-------|-----------|-----|
| nova | Warm, expressive female | **Best fit for Imogen** |
| shimmer | Soft, gentle female | Alternative |
| onyx | Deep, authoritative male | If user prefers |

### Format

- **Output:** `opus` (OGG Opus) — Telegram's native voice message format
- **No conversion needed** — OpenAI outputs Opus directly

---

## 5. Telegram Voice Delivery

### API Call

```typescript
async function sendVoiceMessage(
  chatId: number,
  audioBuffer: Buffer,
  duration: number  // in seconds
): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  const formData = new FormData()
  formData.append('chat_id', chatId.toString())
  formData.append('voice', new Blob([audioBuffer], { type: 'audio/ogg' }), 'digest.ogg')
  formData.append('duration', duration.toString())

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendVoice`,
    { method: 'POST', body: formData }
  )

  const data = await response.json()
  return data.ok ? data.result.voice.file_id : null
}
```

### Response

Telegram returns a `file_id` we can store for replay/reference.

---

## 6. Cron Endpoint

### Vercel Cron Config (`vercel.json`)

```json
{
  "crons": [
    {
      "path": "/api/cron/digest",
      "schedule": "0 * * * *"
    }
  ]
}
```

Runs every hour. The endpoint checks which users need their digest NOW based on their timezone and preferred time.

### Endpoint Logic

```typescript
// GET /api/cron/digest

export async function GET(request: NextRequest) {
  // 1. Verify Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Find users whose digest time matches current hour
  const users = await getUsersForDigestNow()

  // 3. For each user, generate and send digest
  for (const user of users) {
    await generateAndSendDigest(user)
  }

  return NextResponse.json({ processed: users.length })
}
```

### Timezone Logic

```typescript
async function getUsersForDigestNow(): Promise<User[]> {
  const supabase = createServiceClient()

  // Get all users with digest enabled
  const { data: users } = await supabase
    .from('users')
    .select('*')
    .eq('digest_enabled', true)

  const now = new Date()

  return users.filter(user => {
    // Convert current UTC time to user's timezone
    const userTime = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }))
    const userHour = userTime.getHours()
    const userMinute = userTime.getMinutes()

    // Parse user's preferred time
    const [prefHour] = user.digest_time.split(':').map(Number)

    // Match if we're in the right hour (cron runs hourly)
    return userHour === prefHour && userMinute < 5  // 5-min grace window
  })
}
```

---

## 7. File Structure

```
src/
  lib/
    digest/
      imogen.ts        # Persona/soul definition
      generator.ts     # LLM script generation
      tts.ts           # OpenAI TTS wrapper
      sender.ts        # Telegram voice delivery
      index.ts         # Orchestrator: generateAndSendDigest()
  app/
    api/
      cron/
        digest/
          route.ts     # Vercel cron endpoint
```

---

## 8. Orchestration Flow

```typescript
// src/lib/digest/index.ts

export async function generateAndSendDigest(user: User): Promise<void> {
  const supabase = createServiceClient()

  // 1. Get items from last 24 hours
  const items = await getItemsForDigest(user.id)

  if (items.length === 0) {
    // Send "nothing new" message
    await sendEmptyDayMessage(user)
    return
  }

  // 2. Get previous digest for continuity
  const previousDigest = await getPreviousDigest(user.id)

  // 3. Generate script
  const script = await generateScript({
    user: { id: user.id, displayName: user.display_name, timezone: user.timezone },
    items,
    previousDigest,
  })

  // 4. Convert to audio
  const audioBuffer = await textToSpeech(script)

  // 5. Send via Telegram
  const telegramFileId = await sendVoiceMessage(
    user.telegram_user_id,
    audioBuffer,
    estimateDuration(script)
  )

  // 6. Store digest record
  await supabase.from('digests').insert({
    user_id: user.id,
    script_text: script,
    telegram_file_id: telegramFileId,
    item_ids: items.map(i => i.id),
    item_count: items.length,
    previous_digest_id: previousDigest?.id || null,
  })
}
```

---

## 9. Testing Plan

### Manual Trigger Endpoint

Add a test endpoint (dev only):

```typescript
// GET /api/cron/digest?test=true&user_id=xxx

if (searchParams.get('test') === 'true') {
  const userId = searchParams.get('user_id')
  const user = await getUser(userId)
  await generateAndSendDigest(user)
  return NextResponse.json({ ok: true, message: 'Test digest sent' })
}
```

### Test Checklist

- [ ] Empty day → sends brief "nothing new" voice message
- [ ] 1 item → generates short script, sends voice
- [ ] 5+ items → generates full script with categories
- [ ] With previous digest → references it in opening
- [ ] No previous digest → clean intro without awkward reference
- [ ] TTS failure → logs error, doesn't crash
- [ ] Telegram failure → logs error, stores digest anyway

---

## 10. Environment Variables

```bash
# Add to .env
CRON_SECRET=xxx              # Vercel cron auth
OPENAI_API_KEY=xxx           # Already exists, used for TTS
```

---

## 11. Cost Per Digest

| Component | Budget | Quality |
|-----------|--------|---------|
| Script gen (GPT-4o-mini) | ~$0.002 | ~$0.002 |
| Script gen (Claude Sonnet) | — | ~$0.02 |
| Script gen (Claude Opus) | — | ~$0.10 |
| OpenAI TTS (800 words) | ~$0.075 | ~$0.075 |
| **Total per digest** | **~$0.08** | **~$0.18** |
| **Monthly (1 user)** | **~$2.40** | **~$5.40** |

Going with Claude Sonnet/Opus adds ~$3/month per user — worth it for quality.

---

## Questions Resolved

| Question | Decision |
|----------|----------|
| Persona name | **Imogen** |
| Voice | **nova** (OpenAI) |
| Audio format | **opus** (native Telegram) |
| Storage | **telegram_file_id** (no separate storage needed) |
| Timezone handling | **Hourly cron, filter by user timezone** |
| Continuity | **Store previous_digest_id, include script in prompt** |
