# LazyList

Personal knowledge capture system. Share links from your phone, auto-extract intelligence, query via Claude Code.

## How It Works

1. **Capture** — Share a link from your phone (TikTok, GitHub, articles)
2. **Process** — AI extracts metadata, transcribes videos, classifies content
3. **Store** — Everything goes to Supabase with searchable metadata
4. **Query** — Run `/lazylist` in Claude Code to find relevant items for your current project

## Stack

- **Frontend/API:** Next.js 15
- **Database:** Supabase (Postgres)
- **AI:** OpenAI GPT-4o Mini (transcription, classification)
- **Hosting:** Vercel

## Setup

### 1. Clone and install

```bash
git clone https://github.com/mcfwalker/lazylist.git
cd lazylist
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

# GitHub (optional, for higher rate limits)
GITHUB_TOKEN=xxx

# API auth (generate with: openssl rand -hex 32)
API_SECRET_KEY=xxx
```

### 3. Run locally

```bash
npm run dev
```

### 4. Deploy to Vercel

Connect the repo to Vercel and add the same environment variables.

### 5. Set up Telegram Bot (recommended)

The Telegram bot is the easiest way to capture links from any device.

1. Create a bot via [@BotFather](https://t.me/BotFather) (`/newbot`)
2. Add `TELEGRAM_BOT_TOKEN` to your environment
3. Get your user ID from [@userinfobot](https://t.me/userinfobot)
4. Add your ID to `TELEGRAM_ALLOWED_USERS` (comma-separated for multiple users)
5. Register the webhook:
   ```bash
   curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://lazylist.mcfw.io/api/telegram"
   ```

Now just share any link to your bot to capture it.

## API

### `POST /api/capture`

Capture a new URL.

```bash
curl -X POST https://lazylist.mcfw.io/api/capture \
  -H "Authorization: Bearer YOUR_API_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/user/repo"}'
```

### `GET /api/items`

List items with optional filters: `?domain=vibe-coding&type=repo&status=processed&q=search`

### `PATCH /api/items/:id`

Update an item (domain, content_type, tags, title, summary).

## Claude Code Skill

Run `/lazylist` in Claude Code to search your captured knowledge for items relevant to your current project.

## License

MIT
