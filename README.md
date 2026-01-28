# MollyMemo

Personal knowledge capture system with AI-powered daily voice digests. Share links from your phone → auto-extract intelligence → get a personalized audio summary from Molly every morning.

## How It Works

1. **Capture** — Share a link to the Telegram bot (TikTok, X/Twitter, GitHub, articles)
2. **Process** — AI extracts metadata, transcribes videos, classifies content, finds GitHub repos
3. **Store** — Everything goes to Supabase with searchable metadata
4. **Digest** — Molly sends you a personalized voice message summarizing yesterday's captures
5. **Query** — Run `/mollymemo` in Claude Code to find relevant items for your current project

## Features

- **Telegram Bot** — Primary capture method. Just share any link to @MollyMemoBot
- **Voice Digest** — Daily personalized audio summary with TTS
- **Smart Extraction** — Video transcription, GitHub repo detection, article summarization
- **Multi-User** — Each user gets their own knowledge base and digest preferences
- **Cost Tracking** — Per-item cost tracking for all AI operations

## Stack

- **Frontend/API:** Next.js 15 on Vercel
- **Database:** Supabase (Postgres)
- **AI:** OpenAI GPT-4o Mini (transcription, classification, TTS), Anthropic Claude (digest generation), xAI Grok (X content)
- **Delivery:** Telegram Bot API

## Setup

### 1. Clone and install

```bash
git clone https://github.com/mcfwalker/mollymemo.git
cd mollymemo
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in:

```bash
# Supabase (from dashboard → Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# OpenAI (from platform.openai.com)
OPENAI_API_KEY=xxx

# Anthropic (for digest generation)
ANTHROPIC_API_KEY=xxx

# xAI/Grok (optional, for X content extraction)
XAI_API_KEY=xxx

# GitHub (optional, for higher rate limits)
GITHUB_TOKEN=xxx

# Telegram Bot (from @BotFather)
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_WEBHOOK_SECRET=xxx  # generate with: openssl rand -hex 32

# Vercel Cron (for scheduled digests)
CRON_SECRET=xxx  # generate with: openssl rand -hex 32

# App URL
NEXT_PUBLIC_APP_URL=https://mollymemo.com
```

### 3. Run locally

```bash
npm run dev
```

### 4. Deploy to Vercel

Connect the repo to Vercel and add the same environment variables.

### 5. Set up Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather) (`/newbot`)
2. Add `TELEGRAM_BOT_TOKEN` to your environment
3. Generate a webhook secret and add as `TELEGRAM_WEBHOOK_SECRET`
4. Register the webhook with secret:
   ```bash
   curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://mollymemo.com/api/telegram&secret_token={WEBHOOK_SECRET}"
   ```

### 6. Set up Daily Digest

1. Add `CRON_SECRET` to your environment
2. Vercel Cron runs hourly (configured in `vercel.json`)
3. Users set their preferred digest time via Telegram: "digest at 7am"

## Using the Bot

Send any URL to capture it:
```
https://www.tiktok.com/@user/video/123
```

Digest commands:
- `digest at 7am` — Set digest time
- `digest at 9pm` — Change to evening
- `pause digest` — Disable digests
- `turn it on` — Re-enable digests
- `send my digest` — Get digest now

## API

### `GET /api/items`

List items with optional filters: `?domain=vibe-coding&type=repo&status=processed&q=search`

### `PATCH /api/items/:id`

Update an item (domain, content_type, tags, title, summary).

### `GET /api/users/settings`

Get current user's digest settings.

### `PATCH /api/users/settings`

Update digest settings (digest_enabled, digest_time, timezone).

## Claude Code Skill

Run `/mollymemo` in Claude Code to search your captured knowledge for items relevant to your current project.

## License

MIT
