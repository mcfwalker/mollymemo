# Tech Debt Spike — Feb 2027 Audit

**Date:** 2026-02-27
**Status:** Draft
**Feature:** #7
**Theme:** Engineering Health

## Problem

The Feb 27 codebase audit revealed three HIGH security findings, zero test coverage on the most critical code path (Inngest pipeline), and growing code duplication. The codebase grew 75% since the last audit (Jan 30) but security and test coverage didn't keep pace.

## Approach

Time-boxed spike to address all audit findings, prioritized by risk:
1. **Security fixes** (immediate — block deploys until resolved)
2. **Test coverage** (Inngest pipeline + failing tests)
3. **Code quality** (duplication, type safety)
4. **Observability** (structured logging)

## Tasks

### Security (HIGH — before next deploy)

1. **Fix CORS wildcard on `/api/capture`** — Replace `Access-Control-Allow-Origin: *` with `process.env.NEXT_PUBLIC_APP_URL`. The capture endpoint is deprecated (Telegram is primary), but it's still live and accepts `*` origins.

2. **Fix Telegram webhook secret enforcement** — Make `TELEGRAM_WEBHOOK_SECRET` required in production. Currently `verifyTelegramSecret()` returns `true` if the env var is unset, allowing unauthenticated requests to inject fake captures.

3. **Fix cron test-mode auth bypass** — `/api/cron/digest?test=true` skips the `CRON_SECRET` check entirely in non-production. Either remove the test parameter or require auth for both modes.

4. **Fix rollup dependency vulnerability** — Run `npm audit fix` to resolve the path traversal vulnerability in rollup 4.0.0-4.58.0.

### Test Coverage (HIGH)

5. **Add Inngest pipeline tests** — The 588-line `process-item.ts` orchestrates all item processing and has 0% coverage. Write integration tests with mocked Supabase/OpenAI/external APIs covering the 10-step flow.

6. **Fix failing settings route tests** — 3 test files failing (16 assertions) in `users/settings/route.test.ts`. Implementation diverged from test expectations.

### Code Quality (MEDIUM)

7. **Extract duplicated GitHub URL regex** — The pattern `github\.com\/[^\s"'<>,.]+` appears in 3 processors (tiktok.ts, article.ts, youtube.ts). Extract to `lib/processors/detect.ts` as `extractGitHubUrls()`.

8. **Extract duplicated OpenAI API calls** — Three files make near-identical `fetch()` calls to OpenAI's chat completions endpoint with similar error handling. Extract to shared `lib/openai-client.ts`.

9. **Type `trends.ts` properly** — 9 `any` instances, all in one file. Replace with `SupabaseClient<Database>` generics and proper row types.

### Observability (MEDIUM)

10. **Add structured logging** — Replace 221 `console.*` statements with Pino or similar. Add correlation context `{ itemId, userId, step }` to pipeline logs. This is the oldest recurring recommendation (flagged in both Jan 30 and Feb 27 audits).

### Cleanup (LOW)

11. **Delete duplicate theme** — Two "Platform Extensions & Integrations" themes exist in Sidespace (IDs `fbe22ffa` and `a8e541e5`). Archive the duplicate.
