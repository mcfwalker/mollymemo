# Chrome Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add API key authentication and a Chrome extension for one-click URL capture from the browser.

**Architecture:** New `api_keys` table stores hashed keys. A reusable `resolveUserId()` helper in `src/lib/auth.ts` checks for Bearer token first (hashes it, looks up in `api_keys`), then falls back to the existing `x-user-id` header from middleware. A new `/api/capture` route handles extension captures. The Chrome extension lives in `extension/` at repo root — Manifest V3 service worker + options page.

**Tech Stack:** Next.js API routes, Supabase (Postgres), Node.js `crypto` (SHA-256), Chrome Extension Manifest V3, Vitest

---

## Codebase Patterns Reference

Before implementing, know these established patterns:

- **Migrations:** `supabase/migrations/YYYYMMDD_description.sql`. UUIDs for PKs, `user_id REFERENCES users(id) ON DELETE CASCADE`, `TIMESTAMPTZ DEFAULT NOW()`, always enable RLS.
- **API auth:** Middleware sets `x-user-id` header. Routes call `getCurrentUserId(request)` from `src/lib/auth.ts`. All routes use `createServiceClient()` (service role, bypasses RLS) + manual `user_id` filtering.
- **Public routes:** Listed in `PUBLIC_ROUTES` array in `src/middleware.ts` line 7. These bypass session auth.
- **Test pattern:** Co-located `route.test.ts`. Mock supabase/auth with `vi.mock()`. Chain mock supabase: `from().select().eq().single()` etc. See `src/app/api/users/settings/route.test.ts` for canonical example.
- **Settings UI:** Client component with CSS modules. Uses `.settingCard > .settingRow > .settingInfo + control` layout. CSS in `src/app/settings/page.module.css`.

---

## Task 1: Create `api_keys` table migration (MOL-26)

**Files:**
- Create: `supabase/migrations/20260226_api_keys.sql`

**Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  name TEXT DEFAULT 'Chrome Extension',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own keys" ON api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own keys" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own keys" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON api_keys
  FOR ALL USING (true);
```

**Step 2: Apply migration to Supabase**

Run in the Supabase SQL editor (production) or via `supabase db push` (local). Verify the table exists:

```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'api_keys';
```

**Step 3: Commit**

```bash
git add supabase/migrations/20260226_api_keys.sql
git commit -m "feat(db): add api_keys table migration (MOL-26)"
```

---

## Task 2: Build API key generation and management endpoints (MOL-27)

**Files:**
- Create: `src/app/api/keys/route.ts`
- Create: `src/app/api/keys/route.test.ts`
- Create: `src/app/api/keys/[id]/route.ts`
- Create: `src/app/api/keys/[id]/route.test.ts`

**Step 1: Write failing tests for `POST /api/keys` and `GET /api/keys`**

File: `src/app/api/keys/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, GET } from './route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

describe('API Keys Routes', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  describe('POST /api/keys', () => {
    it('should generate a new API key', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      mockSupabase.single.mockResolvedValue({
        data: { id: 'key-uuid', name: 'Chrome Extension', created_at: '2026-02-26T00:00:00Z' },
        error: null,
      })

      const request = new NextRequest('http://localhost/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: 'Chrome Extension' }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.id).toBe('key-uuid')
      expect(data.key).toBeDefined() // Plaintext key returned once
      expect(data.key).toMatch(/^mm_/) // Prefix for MollyMemo keys
    })

    it('should return 401 for unauthenticated requests', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue(null)

      const request = new NextRequest('http://localhost/api/keys', {
        method: 'POST',
        body: JSON.stringify({}),
      })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/keys', () => {
    it('should list active API keys without hashes', async () => {
      vi.mocked(getCurrentUserId).mockReturnValue('user-123')
      // Mock the chained query: from().select().eq().is().order()
      mockSupabase.order.mockResolvedValue({
        data: [
          { id: 'key-1', name: 'Chrome Extension', created_at: '2026-02-26T00:00:00Z', last_used_at: null },
        ],
        error: null,
      })

      const request = new NextRequest('http://localhost/api/keys')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.keys).toHaveLength(1)
      expect(data.keys[0]).not.toHaveProperty('key_hash')
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/keys/route.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement `POST /api/keys` and `GET /api/keys`**

File: `src/app/api/keys/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'
import { randomBytes, createHash } from 'crypto'

function generateApiKey(): string {
  return 'mm_' + randomBytes(32).toString('base64url')
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export async function POST(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const name = body.name || 'Chrome Extension'

  const plainKey = generateApiKey()
  const keyHash = hashKey(plainKey)

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('api_keys')
    .insert({ user_id: userId, key_hash: keyHash, name })
    .select('id, name, created_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 })
  }

  return NextResponse.json({ ...data, key: plainKey }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, created_at, last_used_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to list keys' }, { status: 500 })
  }

  return NextResponse.json({ keys: data })
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/keys/route.test.ts`
Expected: PASS

**Step 5: Write failing test for `DELETE /api/keys/[id]`**

File: `src/app/api/keys/[id]/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE } from './route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

describe('DELETE /api/keys/[id]', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  it('should revoke an API key', async () => {
    vi.mocked(getCurrentUserId).mockReturnValue('user-123')
    mockSupabase.is.mockResolvedValue({ error: null, count: 1 })

    const request = new NextRequest('http://localhost/api/keys/key-uuid', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'key-uuid' }) })
    expect(response.status).toBe(200)
  })

  it('should return 401 for unauthenticated requests', async () => {
    vi.mocked(getCurrentUserId).mockReturnValue(null)

    const request = new NextRequest('http://localhost/api/keys/key-uuid', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'key-uuid' }) })
    expect(response.status).toBe(401)
  })
})
```

**Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/api/keys/[id]/route.test.ts`
Expected: FAIL

**Step 7: Implement `DELETE /api/keys/[id]`**

File: `src/app/api/keys/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getCurrentUserId } from '@/lib/auth'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getCurrentUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('revoked_at', null)

  if (error) {
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
```

**Step 8: Run all key tests**

Run: `npx vitest run src/app/api/keys/`
Expected: ALL PASS

**Step 9: Commit**

```bash
git add src/app/api/keys/
git commit -m "feat(api): add API key generation, listing, and revocation endpoints (MOL-27)"
```

---

## Task 3: Build API key validation helper (MOL-28)

**Files:**
- Modify: `src/lib/auth.ts`
- Create: `src/lib/auth.test.ts`

**Step 1: Write failing test for `resolveUserId`**

File: `src/lib/auth.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase'

// Import after mocks
import { resolveUserId } from './auth'

describe('resolveUserId', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    single: vi.fn(),
    update: vi.fn().mockReturnThis(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  it('should resolve user from x-user-id header (session auth)', async () => {
    const request = new NextRequest('http://localhost/api/test', {
      headers: { 'x-user-id': 'user-123' },
    })

    const userId = await resolveUserId(request)
    expect(userId).toBe('user-123')
  })

  it('should resolve user from Bearer token (API key auth)', async () => {
    mockSupabase.single.mockResolvedValue({
      data: { user_id: 'user-456' },
      error: null,
    })
    // Mock the update chain for last_used_at
    mockSupabase.eq.mockReturnThis()

    const request = new NextRequest('http://localhost/api/test', {
      headers: { 'Authorization': 'Bearer mm_testkey123' },
    })

    const userId = await resolveUserId(request)
    expect(userId).toBe('user-456')
  })

  it('should return null when no auth provided', async () => {
    const request = new NextRequest('http://localhost/api/test')

    const userId = await resolveUserId(request)
    expect(userId).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL (resolveUserId not exported)

**Step 3: Add `resolveUserId` to `src/lib/auth.ts`**

Add this to the existing file (keep `getCurrentUserId` and `requireUserId` as-is):

```typescript
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase'

/**
 * Resolve user ID from request — checks API key (Bearer token) first,
 * then falls back to session auth (x-user-id header from middleware).
 * Use this for routes that accept both auth methods (e.g., /api/capture).
 */
export async function resolveUserId(request: NextRequest): Promise<string | null> {
  // Check for API key auth first
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7)
    const keyHash = createHash('sha256').update(key).digest('hex')

    const supabase = createServiceClient()
    const { data } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()

    if (data?.user_id) {
      // Fire-and-forget: update last_used_at
      supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('key_hash', keyHash)
      return data.user_id
    }

    return null // Invalid key = reject, don't fall through
  }

  // Fall back to session auth
  return getCurrentUserId(request)
}
```

Note: Add `import type { NextRequest } from 'next/server'` at the top of the file if not already present.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat(auth): add resolveUserId helper for API key + session auth (MOL-28)"
```

---

## Task 4: Create capture endpoint for extension (MOL-30)

**Files:**
- Create: `src/app/api/capture/route.ts`
- Create: `src/app/api/capture/route.test.ts`
- Modify: `src/middleware.ts` (add `/api/capture` to PUBLIC_ROUTES)

**Step 1: Add `/api/capture` to PUBLIC_ROUTES in middleware**

In `src/middleware.ts` line 7, add `/api/capture`:

```typescript
const PUBLIC_ROUTES = ['/login', '/api/auth', '/api/auth/callback', '/api/telegram', '/api/cron', '/api/inngest', '/api/capture']
```

This route must be public because extension requests don't carry session cookies — they use Bearer token auth instead. The `resolveUserId` helper handles API key validation inside the route.

**Step 2: Write failing tests**

File: `src/app/api/capture/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  resolveUserId: vi.fn(),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/processors/detect', () => ({
  detectSourceType: vi.fn().mockReturnValue('article'),
}))

import { createServiceClient } from '@/lib/supabase'
import { resolveUserId } from '@/lib/auth'
import { inngest } from '@/inngest/client'

describe('POST /api/capture', () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    single: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)
  })

  it('should capture a URL', async () => {
    vi.mocked(resolveUserId).mockResolvedValue('user-123')
    // No duplicate
    mockSupabase.limit.mockResolvedValue({ data: [], error: null })
    // Insert succeeds
    mockSupabase.single.mockResolvedValue({
      data: { id: 'item-uuid' },
      error: null,
    })

    const request = new NextRequest('http://localhost/api/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mm_testkey' },
      body: JSON.stringify({ url: 'https://example.com/article' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.id).toBe('item-uuid')
    expect(vi.mocked(inngest.send)).toHaveBeenCalled()
  })

  it('should return 401 for invalid API key', async () => {
    vi.mocked(resolveUserId).mockResolvedValue(null)

    const request = new NextRequest('http://localhost/api/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer mm_badkey' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('should return 400 for missing URL', async () => {
    vi.mocked(resolveUserId).mockResolvedValue('user-123')

    const request = new NextRequest('http://localhost/api/capture', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('should return 409 for duplicate URL within 24h', async () => {
    vi.mocked(resolveUserId).mockResolvedValue('user-123')
    mockSupabase.limit.mockResolvedValue({
      data: [{ id: 'existing-id' }],
      error: null,
    })

    const request = new NextRequest('http://localhost/api/capture', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/dup' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(409)
  })
})
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/app/api/capture/route.test.ts`
Expected: FAIL

**Step 4: Implement the capture route**

File: `src/app/api/capture/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { resolveUserId } from '@/lib/auth'
import { detectSourceType } from '@/lib/processors/detect'
import { inngest } from '@/inngest/client'

export async function POST(request: NextRequest) {
  const userId = await resolveUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { url } = body

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Check for recent duplicate (same URL in last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: existing } = await supabase
    .from('items')
    .select('id')
    .eq('source_url', parsedUrl.href)
    .eq('user_id', userId)
    .gte('captured_at', oneDayAgo)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Already captured recently' }, { status: 409 })
  }

  const sourceType = detectSourceType(parsedUrl.href)

  const { data: item, error } = await supabase
    .from('items')
    .insert({
      source_url: parsedUrl.href,
      source_type: sourceType,
      status: 'pending',
      user_id: userId,
    })
    .select('id')
    .single()

  if (error || !item) {
    return NextResponse.json({ error: 'Failed to capture' }, { status: 500 })
  }

  await inngest.send({
    name: 'item/captured',
    data: {
      itemId: item.id,
      sourceType,
      sourceUrl: parsedUrl.href,
      userId,
    },
  })

  return NextResponse.json({ id: item.id, status: 'pending' }, { status: 201 })
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/api/capture/route.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/app/api/capture/ src/middleware.ts
git commit -m "feat(api): add /api/capture endpoint with API key auth (MOL-30)"
```

---

## Task 5: Add API key management UI to Settings page (MOL-29)

**Files:**
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/settings/page.module.css`

**Step 1: Add API key state and methods to `page.tsx`**

Add to the existing SettingsPage component:

- New state: `apiKeys` (array), `newKey` (string, shown once after generation), `generatingKey` (boolean)
- `fetchApiKeys()` — called on mount alongside existing settings fetch
- `generateKey()` — `POST /api/keys`, stores result in `newKey` state
- `revokeKey(id)` — `DELETE /api/keys/${id}`, removes from local state

**Step 2: Add API Keys section to JSX**

Insert a new `<section>` between "Trend Reports" and "General" sections:

```tsx
<section className={styles.section}>
  <h2 className={styles.sectionTitle}>API Keys</h2>

  <div className={styles.settingCard}>
    <div className={styles.settingRow}>
      <div className={styles.settingInfo}>
        <span className={styles.settingLabel}>Chrome Extension</span>
        <span className={styles.settingDescription}>
          Generate an API key for the MollyMemo Chrome extension
        </span>
      </div>
      <button
        onClick={generateKey}
        disabled={generatingKey}
        className={styles.button}
      >
        {generatingKey ? 'Generating...' : 'Generate Key'}
      </button>
    </div>

    {newKey && (
      <div className={styles.keyReveal}>
        <p className={styles.keyWarning}>
          Copy this key now — it won't be shown again
        </p>
        <div className={styles.keyDisplay}>
          <code className={styles.keyCode}>{newKey}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(newKey); }}
            className={styles.copyButton}
          >
            Copy
          </button>
        </div>
      </div>
    )}

    {apiKeys.map((key) => (
      <div key={key.id} className={styles.keyRow}>
        <div className={styles.keyInfo}>
          <span className={styles.keyName}>{key.name}</span>
          <span className={styles.keyMeta}>
            Created {new Date(key.created_at).toLocaleDateString()}
            {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
          </span>
        </div>
        <button
          onClick={() => revokeKey(key.id)}
          className={styles.revokeButton}
        >
          Revoke
        </button>
      </div>
    ))}
  </div>
</section>
```

**Step 3: Add CSS styles**

Add to `src/app/settings/page.module.css`:

```css
/* Buttons */
.button {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.button:hover {
  opacity: 0.9;
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Key reveal */
.keyReveal {
  margin-top: 16px;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 8px;
}

.keyWarning {
  font-size: 13px;
  color: var(--accent-foreground);
  margin: 0 0 8px;
  font-weight: 500;
}

.keyDisplay {
  display: flex;
  align-items: center;
  gap: 8px;
}

.keyCode {
  flex: 1;
  padding: 8px;
  font-size: 13px;
  font-family: monospace;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
  word-break: break-all;
}

.copyButton {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}

.copyButton:hover {
  background: var(--border);
}

/* Key list */
.keyRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--border);
  margin-top: 12px;
}

.keyInfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.keyName {
  font-size: 14px;
  color: var(--text);
}

.keyMeta {
  font-size: 12px;
  color: var(--text-muted);
}

.revokeButton {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.revokeButton:hover {
  border-color: #ef4444;
  color: #ef4444;
}
```

**Step 4: Verify in browser**

Run dev server (`npm run dev`), navigate to http://localhost:3000/settings. Verify:
- "API Keys" section appears
- "Generate Key" button works
- Key is shown with copy button
- Revoke button works

**Step 5: Commit**

```bash
git add src/app/settings/
git commit -m "feat(ui): add API key management to Settings page (MOL-29)"
```

---

## Task 6: Create Chrome extension manifest and service worker (MOL-31)

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/icons/` (placeholder icons)

**Step 1: Create extension directory and manifest**

File: `extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "MollyMemo",
  "version": "1.0.0",
  "description": "One-click URL capture for MollyMemo",
  "permissions": ["activeTab", "storage"],
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "Capture to MollyMemo"
  },
  "background": {
    "service_worker": "background.js"
  },
  "options_page": "options.html",
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 2: Create the service worker**

File: `extension/background.js`

```javascript
const API_BASE = 'https://mollymemo.com'

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    showBadge('!', '#f59e0b') // Warning for unsupported pages
    return
  }

  const { apiKey } = await chrome.storage.sync.get('apiKey')
  if (!apiKey) {
    chrome.runtime.openOptionsPage()
    return
  }

  try {
    showBadge('...', '#64748b')

    const response = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: tab.url }),
    })

    if (response.ok) {
      showBadge('✓', '#22c55e')
    } else if (response.status === 409) {
      showBadge('=', '#64748b') // Already captured
    } else if (response.status === 401) {
      showBadge('!', '#ef4444')
      chrome.runtime.openOptionsPage()
    } else {
      showBadge('✗', '#ef4444')
    }
  } catch {
    showBadge('✗', '#ef4444')
  }
})

function showBadge(text, color) {
  chrome.action.setBadgeText({ text })
  chrome.action.setBadgeBackgroundColor({ color })
  if (text !== '...') {
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000)
  }
}
```

**Step 3: Create placeholder icons**

Generate simple placeholder PNGs (or use a script). The icons can be polished later in the Visual Refresh feature. For now, create solid-color squares:

```bash
# If ImageMagick is available:
mkdir -p extension/icons
for size in 16 32 48 128; do
  convert -size ${size}x${size} xc:'#6366f1' extension/icons/icon${size}.png
done
```

If ImageMagick isn't available, create the icons manually or use any placeholder PNG files. The extension will work without proper icons — Chrome shows a default puzzle piece.

**Step 4: Commit**

```bash
git add extension/
git commit -m "feat(ext): create Chrome extension manifest and service worker (MOL-31)"
```

---

## Task 7: Create extension options page (MOL-32)

**Files:**
- Create: `extension/options.html`
- Create: `extension/options.js`

**Step 1: Create options HTML**

File: `extension/options.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MollyMemo Extension Options</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 32px;
      max-width: 480px;
      color: #0f172a;
    }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #64748b; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    input {
      width: 100%;
      padding: 10px 12px;
      font-size: 14px;
      font-family: monospace;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      outline: none;
    }
    input:focus { border-color: #6366f1; }
    .help {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 8px;
    }
    .help a { color: #6366f1; }
    .status {
      margin-top: 16px;
      padding: 10px;
      border-radius: 6px;
      font-size: 14px;
      display: none;
    }
    .status.saved {
      display: block;
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bbf7d0;
    }
  </style>
</head>
<body>
  <h1>MollyMemo</h1>
  <p class="subtitle">Configure your API key for one-click capture</p>

  <label for="apiKey">API Key</label>
  <input type="password" id="apiKey" placeholder="mm_..." autocomplete="off">
  <p class="help">
    Generate a key at <a href="https://mollymemo.com/settings" target="_blank">mollymemo.com/settings</a>
  </p>

  <div id="status" class="status"></div>

  <script src="options.js"></script>
</body>
</html>
```

**Step 2: Create options JS**

File: `extension/options.js`

```javascript
const input = document.getElementById('apiKey')
const status = document.getElementById('status')

// Load saved key
chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey) input.value = apiKey
})

// Save on change (debounced)
let saveTimer
input.addEventListener('input', () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const apiKey = input.value.trim()
    chrome.storage.sync.set({ apiKey }, () => {
      status.textContent = apiKey ? 'Key saved' : 'Key cleared'
      status.className = 'status saved'
      setTimeout(() => { status.className = 'status' }, 2000)
    })
  }, 500)
})
```

**Step 3: Test locally**

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" → select the `extension/` folder
4. Click the MollyMemo extension icon → should open options page (no key set)
5. Enter an API key → should show "Key saved"
6. Click icon on any page → should attempt capture

**Step 4: Commit**

```bash
git add extension/options.html extension/options.js
git commit -m "feat(ext): add options page for API key configuration (MOL-32)"
```

---

## Task 8: End-to-end test (MOL-33)

**Files:** None (manual testing checklist)

**Checklist:**

1. **Generate key:** Go to `https://mollymemo.com/settings` → Generate Key → Copy the key
2. **Configure extension:** Open extension options → Paste key → See "Key saved"
3. **Capture success:** Navigate to any article URL → Click extension icon → Green checkmark badge → Item appears in MollyMemo
4. **Duplicate detection:** Click icon again on same page → Grey `=` badge (409)
5. **Invalid key:** Change key to garbage in options → Click icon → Red `!` badge → Opens options page
6. **Revoke key:** Go to Settings → Revoke key → Click icon → Red `!` badge
7. **Unsupported page:** Go to `chrome://settings` → Click icon → Yellow `!` badge
8. **No key set:** Clear key from options → Click icon → Opens options page

After verifying, mark MOL-33 as done.

---

## Task 9: Package extension (MOL-34)

**Files:**
- Modify: `extension/icons/` (proper icons if not already done)

**Step 1: Create proper icons**

Replace placeholder icons with real MollyMemo-branded icons at 16, 32, 48, 128px. Can be done with any image editor or SVG export.

**Step 2: Package as ZIP for Chrome Web Store (or local distribution)**

```bash
cd extension && zip -r ../mollymemo-extension.zip . -x '.*'
```

For personal use, "Load unpacked" is sufficient. For Chrome Web Store publishing:
1. Go to https://chrome.google.com/webstore/devconsole
2. Pay one-time $5 developer fee
3. Upload ZIP, fill in listing details, submit for review

**Step 3: Commit**

```bash
git add extension/
git commit -m "chore(ext): finalize icons and packaging (MOL-34)"
```

---

## Summary

| Task | Ticket | What | Files |
|------|--------|------|-------|
| 1 | MOL-26 | `api_keys` table migration | `supabase/migrations/20260226_api_keys.sql` |
| 2 | MOL-27 | Key CRUD endpoints | `src/app/api/keys/route.ts`, `src/app/api/keys/[id]/route.ts` + tests |
| 3 | MOL-28 | `resolveUserId` auth helper | `src/lib/auth.ts` + test |
| 4 | MOL-30 | `/api/capture` endpoint | `src/app/api/capture/route.ts` + test, `src/middleware.ts` |
| 5 | MOL-29 | Settings UI for key management | `src/app/settings/page.tsx`, `page.module.css` |
| 6 | MOL-31 | Extension manifest + service worker | `extension/manifest.json`, `extension/background.js` |
| 7 | MOL-32 | Extension options page | `extension/options.html`, `extension/options.js` |
| 8 | MOL-33 | E2E test | Manual checklist |
| 9 | MOL-34 | Packaging | `extension/icons/`, ZIP |
