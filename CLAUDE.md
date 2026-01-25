# LazyList

Personal knowledge capture system. Share links from phone → auto-extract intelligence → query via Claude Code.

## Status

**v0.1** — In development

## Stack

- **Frontend/API:** Next.js on Vercel
- **Database:** Supabase (Postgres)
- **AI:** Gemini 2.0 Flash (analysis), ElevenLabs (transcription)

## Design Docs

- [v0.1 Design](docs/plans/2026-01-25-lazylist-v0.1-design.md)

## Commands

```bash
npm run dev      # Local development
npm run build    # Production build
```

## Key Files

- `src/app/api/capture/route.ts` — Capture endpoint for iOS Shortcut
- `src/lib/processors/` — Source-specific extraction (TikTok, GitHub, article)
- `src/lib/classifier.ts` — AI categorization

## Environment Variables

See `.env.example` for required variables.
