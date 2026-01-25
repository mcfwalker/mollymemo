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
- **AI:** Gemini 2.0 Flash (classification), ElevenLabs (transcription)
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

# ElevenLabs (from elevenlabs.io dashboard)
ELEVENLABS_API_KEY=xxx

# Gemini (from aistudio.google.com)
GEMINI_API_KEY=xxx

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

### 5. Create iOS Shortcut

1. Create new Shortcut
2. Add "Receive input from Share Sheet" (URLs)
3. Add "Get Contents of URL" action:
   - URL: `https://your-app.vercel.app/api/capture`
   - Method: POST
   - Headers: `Authorization: Bearer YOUR_API_SECRET_KEY`
   - Body: JSON `{"url": "[Shortcut Input]"}`
4. Add "Show Notification": "✓ Captured"

## API

### `POST /api/capture`

Capture a new URL.

```bash
curl -X POST https://your-app.vercel.app/api/capture \
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
