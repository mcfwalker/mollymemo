# MollyMemo Codebase & Architecture Audit

## 0. Audit Metadata

* **Project:** mollymemo
* **Version:** 0.1.0
* **Date:** 2026-02-27
* **Reviewer:** Claude Code (Opus 4.6)
* **Review Type:** Codebase health assessment
* **Previous Audit:** 2026-01-30

### Scope
Full stack review including:
- Source code architecture (src/app, src/lib, src/inngest, src/components)
- API routes, middleware, and background job pipeline (Inngest)
- Data processors (TikTok, GitHub, X/Twitter, Article, YouTube, PDF)
- Authentication, authorization, and security patterns
- Test coverage across all layers
- Documentation completeness
- Delta analysis against Jan 30 audit

### Out of Scope
node_modules, build artifacts, external dependency internals

---

## 1. Executive Summary

* **Overall Assessment:** Good — Significant feature growth since Jan 30 audit while maintaining architectural quality. Security posture has regressed slightly with new attack surface from YouTube/Inngest additions.
* **High-Level Verdict:** The codebase has nearly doubled in size (67→117 files) since the last audit, adding YouTube processing, Inngest background jobs, PDF extraction, trend detection, and project relevance tagging. Architecture remains clean with proper separation of concerns. Three security issues need attention: CORS wildcard on capture endpoint, optional Telegram webhook secret, and test-mode auth bypass on cron endpoint.
* **Release Readiness:** Proceed with conditions — fix 3 HIGH security findings before next production push

---

## 2. Unified Readiness Scorecard

| Dimension                      | Score | Prev | Trend | Ship-Blocking? | Notes |
| ------------------------------ | ----- | ---- | ----- | -------------- | ----- |
| Architecture Health            | B+    | B+   | →     | No | Clean separation maintained despite 75% growth; 2 god files (588, 740 lines) |
| Code Quality & Maintainability | B     | B+   | ↓     | No | Moderate code duplication (GitHub URL regex 3x, OpenAI calls 3x); no TODOs |
| Type Safety & Data Integrity   | B+    | A-   | ↓     | No | `any` usage grew 5→9 (trends.ts); 7 unsafe casts in production; no Zod |
| Security Posture               | B-    | A    | ↓↓    | **Yes** | 3 HIGH findings: CORS wildcard, optional webhook secret, test-mode bypass |
| Test Coverage & Confidence     | C+    | B+   | ↓     | No | 417 tests (was ~180), but Inngest layer 0% tested; API routes dropped to 42% |
| Performance & Scalability      | B     | B    | →     | No | Zero caching strategy; Inngest adds durability but no perf optimization |
| Product-Code Alignment         | A     | A    | →     | No | All roadmap items implemented; YouTube, trends, project relevance all live |
| Future Feasibility             | B+    | B+   | →     | No | Processor pattern is highly extensible; Inngest pipeline well-structured |
| Operational Risk               | B-    | B    | ↓     | No | 221 console statements; no structured logging; no correlation IDs |
| UI/Styling Consistency         | B     | B    | →     | No | Minimal UI matches product philosophy; 10 components |

**Overall Ship Readiness:** Yellow — fix security findings before next deploy

---

## 3. Quantitative Metrics

### Codebase Overview

| Metric | Current | Jan 30 | Delta |
|--------|---------|--------|-------|
| Total .ts files | 98 | 53 | +85% |
| Total .tsx files | 19 | 14 | +36% |
| Total source files | 117 | 67 | +75% |
| Component files | 10 | 8 | +2 |
| API route files | 37 | 20 | +85% |
| Lib/utility modules | 19 | 10 | +90% |
| Processor files | 10 | 9 | +1 (YouTube) |
| Test files | 37 | 23 | +61% |
| Total lines of code | ~11,271 | ~6,000 | +88% |

**Top 5 Largest Production Files:**

| File | Lines | Status |
|------|-------|--------|
| `src/inngest/functions/generate-report.ts` | 740 | NEW — god file |
| `src/inngest/functions/process-item.ts` | 588 | NEW — god file |
| `src/lib/containers.ts` | 406 | Existing |
| `src/lib/processors/repo-extractor.ts` | 404 | Existing |
| `src/lib/digest/index.ts` | 363 | NEW |

### Type Safety

| Metric | Current | Jan 30 | Delta |
|--------|---------|--------|-------|
| `any` usage (prod) | 9 | 5 | +4 (all in trends.ts) |
| `as any` casts | 0 | 0 | — |
| `as unknown as` (prod) | 7 | 0 | +7 |
| TS errors (prod) | 0 | 0 | — |
| TS errors (tests) | 4 | 12 | -8 (improved) |
| `@ts-ignore` | 0 | 0 | — |
| Exported types/interfaces | 50 | ~25 | +100% |

**Strict mode:** Enabled. No Zod or runtime schema validation library.

### Security Scan Results

| Check | Findings | Severity |
|-------|----------|----------|
| SQL Injection patterns | None — Supabase SDK parameterizes all queries | None |
| IDOR-vulnerable endpoints | None — all endpoints verify `.eq('user_id', userId)` | None |
| Unprotected sensitive routes | 3 routes with weak auth patterns | HIGH |
| Hardcoded secrets | 0 (InnerTube key just fixed this session) | None |
| Dependency vulnerabilities | 1 — rollup path traversal (build-time) | HIGH |
| CORS misconfiguration | `/api/capture` uses `Access-Control-Allow-Origin: *` | HIGH |
| Optional auth fallback | Telegram webhook accepts requests if secret unset | MEDIUM |
| Test-mode auth bypass | `/api/cron/digest?test=true` skips CRON_SECRET check | HIGH |
| XSS protection | Properly escaped with `escapeHtml()` | None |

### Testing (Layer-by-Layer)

| Layer | Files | Tested | Coverage % | Grade | Prev Grade |
|-------|-------|--------|------------|-------|------------|
| Processors | 10 | 9 | 90% | A | A |
| Lib/digest | 6 | 5 | 83% | A- | N/A (new) |
| Lib/discovery | 1 | 1 | 100% | A | N/A (new) |
| Lib/utils | 11 | 8 | 73% | B | B |
| Components | 7 | 3 | 43% | C | B+ |
| API routes | 26 | 11 | 42% | C | C+ |
| **Inngest jobs** | **7** | **0** | **0%** | **F** | N/A (new) |

**Overall Test Grade: C+** (down from B+)

**Key gap:** The entire Inngest layer (7 files, including the 588-line core pipeline) has zero test coverage. This is the most critical code in the system — all item processing flows through it.

**Failing tests:** 3 files, 16 assertions failing in `users/settings/route.test.ts` (implementation diverged from test expectations).

---

## 4. Architecture Review

### Current Architecture

```
src/
├── app/
│   ├── api/ (37 routes)
│   │   ├── telegram/          # Primary capture webhook
│   │   ├── capture/           # REST capture (deprecated)
│   │   ├── inngest/           # Inngest webhook handler
│   │   ├── items/, containers/, keys/  # CRUD
│   │   ├── auth/              # OAuth flow
│   │   ├── cron/digest/       # Scheduled digest
│   │   ├── stats/, admin/     # Analytics
│   │   └── trends/, reports/, projects/, users/
│   ├── containers/, login/, reports/, settings/  # Pages
│   └── admin/stats/           # Admin UI
├── inngest/                   # NEW: Background job orchestration
│   ├── client.ts
│   └── functions/
│       ├── process-item.ts    # 10-step extraction pipeline (588 lines)
│       ├── generate-report.ts # Trend report generation (740 lines)
│       ├── detect-trends.ts   # Trend detection
│       ├── discover.ts        # HN discovery
│       └── merge-containers.ts
├── lib/
│   ├── processors/            # 10 source-specific extractors
│   ├── digest/                # NEW: Email digest generation
│   ├── discovery/             # NEW: Trend detection
│   ├── config/                # Domain definitions
│   └── (19 utility modules)
├── components/ (10 React components)
├── types/
└── middleware.ts
```

### Strengths
- **Processor isolation** — Each source type is an independent, testable module returning `result | null`
- **Inngest pipeline** — 10-step durable pipeline with retry safety and cost tracking per step
- **Graceful degradation** — Missing transcript/metadata doesn't break pipeline; null returns are non-fatal
- **User-scoped queries** — All data access filtered by `user_id` at query level (not post-fetch)
- **Idempotent upserts** — Container assignments use `onConflict` to handle retries safely
- **Cost attribution** — Every AI API call returns cost, accumulated per item for analytics

### Weaknesses
- **Two god files** — `process-item.ts` (588 lines) and `generate-report.ts` (740 lines)
- **Code duplication** — GitHub URL regex (3 places), OpenAI API calls (3 places), cost calculation (3 places)
- **No structured logging** — 221 console statements with no log levels, no correlation IDs
- **Zero Inngest testing** — Most critical code path has 0% coverage
- **Inline fallback chains** — X/Twitter Grok→oembed logic sprawls ~40 lines in process-item.ts
- **No caching** — Every request hits database/external APIs; no HTTP cache headers

### Technical Debt

| Item | Priority | Since | Impact |
|------|----------|-------|--------|
| Inngest pipeline untested (7 files) | HIGH | New | Reliability |
| Code duplication (GitHub regex, OpenAI calls, cost calc) | MEDIUM | New | Maintainability |
| No structured logging (221 console.*) | MEDIUM | Jan 30 | Observability |
| `generate-report.ts` at 740 lines | MEDIUM | New | Maintainability |
| `process-item.ts` at 588 lines | MEDIUM | New | Maintainability |
| No runtime schema validation (Zod) | LOW | Jan 30 | Data integrity |
| `any` usage in trends.ts (9 instances) | LOW | New | Type safety |
| 3 failing test files (16 assertions) | LOW | New | Test health |

---

## 5. Product Alignment

### Assessment

The codebase implements all planned features from the roadmap:

| Feature | Status | Since Last Audit |
|---------|--------|------------------|
| Telegram capture | ✅ | Existing |
| TikTok processing | ✅ | Existing |
| GitHub processing | ✅ | Existing |
| X/Twitter + Grok | ✅ | Existing |
| Article extraction | ✅ | Existing |
| **YouTube processing** | ✅ | **NEW** — InnerTube API + oEmbed |
| **PDF extraction** | ✅ | **NEW** — pdf-parse integration |
| Voice digest | ✅ | Existing |
| **Trend detection** | ✅ | **NEW** — detect-trends Inngest job |
| **Trend reports** | ✅ | **NEW** — Claude Opus generation |
| **Project relevance** | ✅ | **NEW** — Sidespace integration |
| **Container merge** | ✅ | **NEW** — dedup logic |
| **Inngest pipeline** | ✅ | **NEW** — replaced `after()` with durable jobs |
| **Semantic search** | ✅ | **NEW** — OpenAI embeddings |
| Multi-user + admin | ✅ | Existing |

### Drift Patterns

**Positive drift:** Every feature from the Jan 30 "Long-Term" recommendations has been implemented:
- Embeddings/semantic search (was "out of scope") → Done
- YouTube support → Done
- Webhook queue → Replaced with Inngest

**No negative drift.** All v0.1 requirements still met.

**Verdict:** Strong — Exceeded roadmap expectations while maintaining focus

---

## 6. Risk Register

| Risk | Category | Likelihood | Impact | Mitigation |
| ---- | -------- | ---------- | ------ | ---------- |
| CORS wildcard on /api/capture | Security | High | Medium | Restrict to app URL |
| Telegram webhook accepts unauthenticated requests | Security | Medium | High | Make secret required in prod |
| Test-mode bypass on cron/digest | Security | Low | High | Remove test param or require auth |
| Rollup path traversal vulnerability | Security | Low | Medium | `npm audit fix` |
| Inngest pipeline 0% test coverage | Quality | High | High | Add integration tests with mocked APIs |
| YouTube InnerTube flaky on Vercel | Functional | High | Medium | Multi-client fallback strategy |
| 740-line generate-report.ts | Maintainability | Medium | Low | Split into orchestrator + helpers |
| No structured logging | Operational | High | Medium | Add Pino/Winston with correlation IDs |
| Resend API key build failure | Operational | Medium | Low | Fix local env or make optional |

---

## 7. Delta Since Last Audit

*Previous audit: 2026-01-30 (28 days ago)*

### Improvements
- **Inngest pipeline** replaced fragile `after()` background processing with durable, retry-safe jobs
- **YouTube processor** added with InnerTube API captions + oEmbed metadata
- **PDF extraction** integrated into article processor
- **Trend detection + reports** — full analytics pipeline with Claude Opus generation
- **Semantic search** via OpenAI embeddings
- **Project relevance tagging** — Sidespace integration for cross-project intelligence
- **Container merge** logic for deduplication
- **Test count grew** from ~180 to 417 (+131%)
- **TS test errors** reduced from 12 to 4
- **Hardcoded secret** (InnerTube key) fixed this session

### Regressions
- **Security posture** dropped A → B- (3 new HIGH findings from expanded attack surface)
- **Test coverage grade** dropped B+ → C+ (Inngest layer at 0%, API routes dropped to 42%)
- **Type safety** dropped A- → B+ (`any` grew 5→9, 7 new unsafe casts)
- **Code duplication** increased (GitHub regex 3x, OpenAI calls 3x)
- **Console logging** grew from 125 to 221 statements (still no structured logger)
- **3 failing test files** (settings route tests diverged from implementation)

### New Risks
- Inngest pipeline is untested (most critical code path)
- YouTube InnerTube unreliable on Vercel
- CORS wildcard on capture endpoint
- Test-mode auth bypass on cron

### Retired Risks
- `after()` reliability (replaced by Inngest)
- Single-point processing failure (Inngest retries handle this)
- Missing webhook queue (Inngest fills this role)

---

## 8. Recommendations

### Immediate (Before Next Deploy)
- [ ] **Fix CORS** on `/api/capture` — restrict `Access-Control-Allow-Origin` to app URL
- [ ] **Fix Telegram webhook** — make `TELEGRAM_WEBHOOK_SECRET` required in production (fail-closed)
- [ ] **Fix cron test mode** — remove `?test=true` bypass or require auth for it
- [ ] **Run `npm audit fix`** — resolve rollup path traversal vulnerability

### Near-Term (Next 1-2 Weeks)
- [ ] **Add Inngest pipeline tests** — mock external APIs, test the 10-step flow end-to-end
- [ ] **Fix 3 failing test files** — align settings route tests with current implementation
- [ ] **Extract duplicated code** — `lib/shared/github-urls.ts`, `lib/shared/openai-client.ts`, `lib/shared/cost-calculator.ts`
- [ ] **Harden YouTube InnerTube** — multi-client fallback (ANDROID → WEB → page scrape)
- [ ] **Add structured logging** — Pino with `{ itemId, userId, step }` context on every pipeline step

### Long-Term
- [ ] **Split god files** — `process-item.ts` into extract/classify/enrich; `generate-report.ts` into data-fetch/render
- [ ] **Add Zod** for runtime validation of external API responses (Supabase, OpenAI, YouTube)
- [ ] **Type trends.ts** properly — replace 9 `any` instances with `SupabaseClient<Database>` generics
- [ ] **Add caching layer** — GitHub metadata (24h TTL), analytics queries (5min TTL)
- [ ] **Error tracking** — Sentry or similar for production error aggregation

---

## 9. Final Call

* **Proceed with roadmap?** Yes — with conditions (fix 3 security findings first)
* **Confidence level:** 7/10 (down from 8/10 — security regressions and test gap in critical pipeline)
* **Rationale:** The codebase has grown impressively — nearly doubling in size while maintaining clean architecture and strong product alignment. The Inngest migration was a major architectural improvement. However, rapid feature velocity has outpaced security hardening and test coverage. The 3 HIGH security findings are straightforward fixes (< 1 hour), and the Inngest test gap should be addressed before adding more pipeline complexity. Once those are resolved, the codebase is well-positioned for continued v0.1 feature development.

---

*Generated by Claude Code (Opus 4.6) on 2026-02-27*
