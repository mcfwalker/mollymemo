# MollyMemo — DEPRECATED

> **Status: end-of-life as of 2026-04-29.**
> Telegram capture has been rerouted to Sidespace's `capture-item` Supabase
> edge function (SSV-272). All Inngest crons (item processing, trend detection,
> reports, merge, discover) are deregistered. The Vercel deployment lingers
> only as a 30-day 307 redirect for `/api/telegram` and will be fully torn down
> on **2026-05-29** (SSV-275).
>
> **Do not add new features to this repo.** New capture / processing work
> belongs in `~/Development/mcfw/sidespace-v2/supabase/functions/`.

## What replaces what

| MollyMemo (retiring) | Sidespace (live) |
|---|---|
| `src/app/api/telegram/route.ts` | `supabase/functions/capture-item/index.ts` |
| `src/inngest/functions/process-item.ts` | `supabase/functions/process-item/index.ts` |
| `src/inngest/functions/discover.ts` | (not ported — superseded by F#29 memory cognition) |
| `src/inngest/functions/detect-trends.ts` | (not ported — superseded by F#29) |
| `src/inngest/functions/generate-report.ts` | (not ported — superseded by Uplink / digests) |
| `src/inngest/functions/merge-containers.ts` | (not ported — concept retired) |
| Chrome extension `extension/` | (not ported — Telegram is the canonical capture surface) |

## Decommission checklist (SSV-275)

- [x] 307 redirect on `/api/telegram` → `capture-item`
- [x] Inngest function registry emptied (crons deregister on next deploy)
- [x] CLAUDE.md marked DEPRECATED
- [ ] Final deploy (push triggers Vercel)
- [ ] Inngest dashboard: confirm crons disappear after deploy
- [ ] 2026-05-29: delete Vercel project, decide on `mollymemo.com` domain

## Historical reference

Original v0.1 design lives at `docs/plans/2026-01-25-lazylist-v0.1-design.md`.
Recent session logs in `docs/sessions/` document the build-out and the SSV-272
cutover.
