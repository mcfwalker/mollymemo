# Chrome Extension

**Date:** 2026-02-26
**Status:** Draft
**Feature:** #3
**Theme:** Platform Extensions & Integrations

## Problem

The only capture method is Telegram, which requires switching apps and pasting a URL. A browser extension enables frictionless one-click capture without leaving the current page.

## Approach

Build a minimal Chrome extension (Manifest V3) that captures the current tab's URL with a single click on the extension icon. Authentication via API key stored in extension options.

### MVP Scope

- Click extension icon → sends current tab URL to MollyMemo capture API
- No popup, no options on click — just capture and show a brief success/error badge
- Extension options page for entering API key
- Badge flash (green checkmark or red X) for feedback

### Auth Flow

1. User navigates to MollyMemo Settings
2. Generates an API key (new feature on settings page)
3. Copies key and pastes into extension options page
4. Extension sends key as `Authorization: Bearer <key>` header on capture requests

### API Changes

- New endpoint or adapt existing `/api/capture` to accept API key auth
- New `api_keys` table for key storage and validation
- Key generation UI on Settings page

## Data Model

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,              -- SHA-256 hash of the key (never store plaintext)
  name TEXT DEFAULT 'Chrome Extension', -- User-friendly label
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ              -- Soft delete
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;
```

## Extension Structure

```
chrome-extension/
  manifest.json          # Manifest V3
  background.js          # Service worker — handles icon click, sends capture request
  options.html           # API key configuration page
  options.js
  icons/                 # 16, 32, 48, 128px icons
```

## Tasks

1. Create `api_keys` table migration
2. Build API key generation endpoint (`POST /api/keys`)
3. Build API key validation middleware
4. Add API key management UI to Settings page
5. Update capture endpoint to accept API key auth
6. Create Chrome extension manifest and service worker
7. Create extension options page
8. Test end-to-end capture flow
9. Package extension for Chrome Web Store (or local install)
