# LazyList

Personal knowledge capture system. Share links from phone → auto-extract intelligence → query via Claude Code.

## Status

**v0.1** — In development

**Production:** https://lazylist.mcfw.io

## Stack

- **Frontend/API:** Next.js on Vercel
- **Database:** Supabase (Postgres)
- **AI:** OpenAI GPT-4o Mini (transcription, classification)

## Design Docs

- [v0.1 Design](docs/plans/2026-01-25-lazylist-v0.1-design.md)

## Commands

```bash
npm run dev      # Local development
npm run build    # Production build
```

## Key Files

- `src/app/api/telegram/route.ts` — Telegram bot webhook (primary capture method)
- `src/app/api/capture/route.ts` — REST API capture endpoint (deprecated - use Telegram)
- `src/lib/processors/` — Source-specific extraction (TikTok, GitHub, article)
- `src/lib/classifier.ts` — AI categorization

## Environment Variables

See `.env.example` for required variables.
