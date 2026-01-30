# MollyMemo Codebase & Architecture Audit

## 0. Audit Metadata

* **Project:** mollymemo
* **Version:** 0.1.0
* **Date:** 2026-01-30
* **Reviewer:** Claude Code
* **Review Type:** Codebase health assessment

### Scope
Full stack review including:
- Source code architecture (src/app, src/lib, src/components)
- API routes and middleware
- Data processors (TikTok, GitHub, X/Twitter, Article)
- Authentication & security patterns
- Test coverage across all layers
- Documentation completeness

### Out of Scope
node_modules, build artifacts, external dependency internals

---

## 1. Executive Summary

* **Overall Assessment:** Good - Well-architected for v0.1 scope with solid security and good test coverage
* **High-Level Verdict:** The codebase successfully implements the knowledge capture system as designed. Architecture is clean with good separation of concerns between capture (Telegram), processing (source-specific extractors), and classification. Security posture is strong with proper ownership checks on all data access.
* **Release Readiness:** Proceed with conditions - Address Next.js security update and minor refactoring opportunities

---

## 2. Unified Readiness Scorecard

| Dimension                      | Score | Ship-Blocking? | Notes |
| ------------------------------ | ----- | -------------- | ----- |
| Architecture Health            | B+    | No             | Clean separation, good patterns, some files need splitting |
| Code Quality & Maintainability | B+    | No             | No TODOs/FIXMEs, minor inconsistency in error handling |
| Type Safety & Data Integrity   | A-    | No             | Minimal `any` usage (5), all production code type-safe |
| Security Posture               | A     | No             | All routes protected, ownership verified, no hardcoded secrets |
| Test Coverage & Confidence     | B+    | No             | 70% avg coverage, processors well-tested, some API gaps |
| Performance & Scalability      | B     | No             | Good async patterns, background processing, potential bottleneck noted |
| Product-Code Alignment         | A     | No             | Fully implements v0.1 design document |
| Future Feasibility             | B+    | No             | Extensible architecture, minor coupling in processor index |
| Operational Risk               | B     | No             | Good error handling, heavy console logging needs attention |
| UI/Styling Consistency         | B     | No             | Minimal UI matches "no cruft" philosophy |

**Overall Ship Readiness:** Green

---

## 3. Quantitative Metrics

### Codebase Overview

| Metric | Count |
|--------|-------|
| Total .ts files | 53 |
| Total .tsx files | 14 |
| Component files | 8 |
| API route files | 20 |
| Lib/utility modules | 35 |
| Test files | 23 |

**Top 10 Largest Files:**
1. `src/lib/processors/repo-extractor.test.ts` - 690 lines (test file - expected)
2. `src/app/api/telegram/route.test.ts` - 464 lines (test file - expected)
3. `src/lib/processors/grok.test.ts` - 453 lines (test file - expected)
4. `src/lib/processors/repo-extractor.ts` - 404 lines ⚠️
5. `src/app/page.module.css` - 401 lines
6. `src/app/api/admin/stats/dashboard/route.ts` - 320 lines
7. `src/app/api/telegram/route.ts` - 317 lines
8. `src/app/admin/stats/page.tsx` - 312 lines
9. `src/lib/processors/index.ts` - 304 lines ⚠️

### Type Safety

| Metric | Count |
|--------|-------|
| `any` usage | 5 |
| `as any` casts | 0 |
| TypeScript errors (production) | 0 |
| TypeScript errors (tests only) | 12 |

**Note:** All 12 TypeScript errors are in test files due to incomplete mock objects. Production code compiles cleanly.

### Security Scan Results

| Check | Findings | Severity |
|-------|----------|----------|
| SQL Injection patterns | 1 (mitigated with input sanitization) | Low |
| IDOR-vulnerable endpoints | 0 | - |
| Unprotected sensitive routes | 0 | - |
| Hardcoded secrets | 0 | - |
| Dependency vulnerabilities | 1 moderate (Next.js) | Medium |

**Security Assessment:** Excellent. The project properly uses parameterized queries via Supabase/PostgREST. All endpoints that access user data verify ownership with `.eq('user_id', userId)`. Admin routes are protected with role checks in middleware.

### Testing (Layer-by-Layer)

| Layer | Files | Tested | Coverage % | Grade |
|-------|-------|--------|------------|-------|
| Lib/utils | 10 | 6 | 60% | B |
| Components | 4 | 3 | 75% | B+ |
| API routes | 13 | 6 | 46% | C+ |
| Processors | 9 | 8 | 89% | A |

**Overall Test Grade: B+**

Processors are exceptionally well-tested (89% coverage). API routes need more coverage (46% - missing tests for admin routes, cron jobs, and user management). Components are mostly covered (75%).

---

## 4. Architecture Review

### Current Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── telegram/route.ts        # Primary capture endpoint
│   │   ├── items/                   # CRUD for items
│   │   ├── auth/                    # Authentication
│   │   ├── users/                   # User management
│   │   ├── stats/                   # Dashboard stats
│   │   ├── admin/stats/             # Admin dashboard
│   │   └── cron/digest/             # Scheduled digest generation
│   ├── page.tsx                     # Main UI (item list)
│   ├── admin/                       # Admin UI
│   └── login/                       # Auth UI
├── lib/
│   ├── processors/                  # Source-specific extractors
│   │   ├── index.ts                 # Orchestration hub
│   │   ├── tiktok.ts                # TikTok processing
│   │   ├── github.ts                # GitHub metadata
│   │   ├── x.ts                     # X/Twitter processing
│   │   ├── article.ts               # Article extraction
│   │   ├── grok.ts                  # Grok AI integration
│   │   ├── repo-extractor.ts        # Smart repo extraction
│   │   ├── classifier.ts            # AI classification
│   │   └── detect.ts                # URL type detection
│   ├── digest/                      # Voice digest system
│   ├── supabase.ts                  # Database client
│   ├── telegram.ts                  # Telegram bot client
│   ├── auth.ts                      # Auth utilities
│   └── security.ts                  # Security utilities
└── components/                      # React components
```

### Strengths

1. **Clean separation of concerns** - Capture, processing, and storage are well-separated
2. **Source-specific processors** - Each content type (TikTok, GitHub, X, Article) has dedicated extraction logic
3. **Async processing with `after()`** - Webhooks respond immediately, processing happens in background
4. **Proper RLS** - All database access respects row-level security
5. **Smart retry logic** - Repo extraction has second-pass logic for transcription errors
6. **Cost tracking** - AI API costs are tracked per item (OpenAI, Grok)
7. **Extensible classification** - Domain/content_type/tags system is flexible

### Weaknesses

1. **Large files** - `repo-extractor.ts` (404 lines) and `processors/index.ts` (304 lines) need splitting
2. **Processor index coupling** - Main orchestration file handles too many source types
3. **Missing API tests** - Admin routes, cron jobs, and some user routes untested
4. **Heavy console logging** - 125 console.log/error calls should use structured logger

### Technical Debt

| Item | Priority | Impact |
|------|----------|--------|
| Refactor repo-extractor.ts into smaller modules | Medium | Maintainability |
| Split processors/index.ts by source type | Medium | Testability |
| Replace console.* with structured logger | Medium | Observability |
| Standardize error variable naming | Low | Consistency |
| Add missing API route tests | Medium | Confidence |

---

## 5. Product Alignment

### Assessment

The codebase fully implements the v0.1 design document (2026-01-25-lazylist-v0.1-design.md):

| Feature | Status | Notes |
|---------|--------|-------|
| Telegram capture | ✅ Implemented | Primary capture method |
| TikTok processing | ✅ Implemented | ElevenLabs transcription |
| GitHub processing | ✅ Implemented | Metadata + classification |
| X/Twitter processing | ✅ Implemented | Grok AI integration (beyond v0.1 scope) |
| Article processing | ✅ Implemented | Readability extraction |
| Web UI | ✅ Implemented | Browse, filter, edit |
| Voice digest | ✅ Implemented | Daily digest with TTS |
| Multi-user support | ✅ Implemented | Row-level security |
| Admin dashboard | ✅ Implemented | Stats and monitoring |

### Drift Patterns

**Positive drift (features beyond v0.1):**
- X/Twitter support added (was "out of scope" in v0.1)
- Voice digest system implemented (was "future" in v0.1)
- Multi-user support complete (was "out of scope")
- Admin dashboard with stats
- Cost tracking for AI APIs

**No negative drift** - All v0.1 requirements met.

**Verdict:** Strong - Exceeded v0.1 scope while maintaining focus

---

## 6. Risk Register

| Risk | Category | Likelihood | Impact | Mitigation |
| ---- | -------- | ---------- | ------ | ---------- |
| Next.js vulnerability exposure | Security | Medium | Medium | Upgrade to 16.1.6 |
| Heavy console logging in prod | Operational | High | Low | Implement structured logger |
| Untested admin routes | Quality | Medium | Low | Add tests |
| repo-extractor.ts complexity | Maintainability | Medium | Low | Refactor into modules |
| TikTok transcription failures | Functional | Medium | Medium | Retry logic exists, monitor rates |
| Grok API rate limits | Operational | Medium | Medium | Cost tracking, fallback to oembed |

---

## 7. Delta Since Last Audit

*Previous audit: 2026-01-28 (2 days ago)*

### Improvements
- Added X/Twitter processor with Grok AI integration
- Implemented voice digest system (generator, TTS, sender)
- Added admin dashboard with comprehensive stats
- Improved repo extraction with second-pass logic
- Added cost tracking for all AI APIs

### Regressions
- None identified

### New Risks
- Grok API dependency for X content (rate limits, costs)

### Retired Risks
- Single-user limitation (now supports multi-user)

---

## 8. Recommendations

### Immediate (Before Next Milestone)
- [ ] Upgrade Next.js to 16.1.6 to fix security vulnerability
- [ ] Add structured logger (pino/winston) and replace console.* calls
- [ ] Add tests for untested API routes (admin, cron, user settings)

### Near-Term (Next 1-2 Builds)
- [ ] Refactor repo-extractor.ts into smaller, focused modules
- [ ] Split processors/index.ts orchestration into source-specific handlers
- [ ] Add error tracking (Sentry) for production issues
- [ ] Implement rate limiting for Grok API calls

### Long-Term
- [ ] Add embeddings/semantic search (was v0.1 out-of-scope)
- [ ] Implement YouTube support
- [ ] Add batch operations for item management
- [ ] Consider webhook queue for high-volume scenarios

---

## 9. Final Call

* **Proceed with roadmap?** Yes - With conditions (address Next.js security update)
* **Confidence level:** 8/10
* **Rationale:** The codebase is well-architected, secure, and fully implements the v0.1 vision. It has even exceeded scope with X/Twitter support and voice digests. Only minor issues (security update, logging, some missing tests) need attention before considering v0.1 complete.

---

*Generated by Claude Code on 2026-01-30*
