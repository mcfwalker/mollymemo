# Agent Knowledge Access Layer

**Date:** 2026-02-26
**Status:** Draft
**Feature:** #6
**Theme:** Intelligence & Curation

## Problem

MollyMemo captures, classifies, and stores knowledge (transcripts, interest graph, embeddings, containers) but most of this data is inaccessible to Sidespace agents. Hoshi's MCP tools (`search_mollymemo`, `list_mollymemo_containers`) return only item metadata — no full content, no interest graph, no related items. Worse, the `search_items` RPC that search depends on **doesn't exist yet**, so semantic search is broken.

The result: MollyMemo is a black box to the agents that should be making it actionable.

### Current State

| Capability | Status | Notes |
|-----------|--------|-------|
| List containers | Working | `list_mollymemo_containers` |
| Search items (semantic) | Broken | `search_items` RPC not implemented |
| Get item full content | No access | Transcript/raw_data not exposed |
| User interest graph | No access | Table exists, no API/RPC |
| Related items | No access | Embeddings exist, no similarity query |
| Temporal patterns | Partial | `/api/trends` exists with CRON_SECRET |

### What Agents Should Be Able To Do

1. **Search and read** — Find items by query, then read the full extracted content
2. **Understand interests** — Ask "What has Matt been interested in lately?" and get a ranked view
3. **Find connections** — "What else has Matt saved that's related to this?" via embedding similarity
4. **Spot trends** — "What topics are trending this month vs last month?"

## Approach

Build Supabase RPC functions and extend the Sidespace MCP server. Keep it simple: RPCs on MollyMemo's Supabase, consumed by existing MCP tools on Sidespace's server.

### Architecture

```
MollyMemo Supabase (RPCs)          Sidespace MCP Server (tools)
┌─────────────────────────┐        ┌──────────────────────────────┐
│ search_items()          │◄───────│ search_mollymemo (fix)       │
│ get_item_content()      │◄───────│ get_mollymemo_item (new)     │
│ get_user_interests()    │◄───────│ get_mollymemo_interests (new)│
│ find_related_items()    │◄───────│ find_related_items (new)     │
└─────────────────────────┘        └──────────────────────────────┘
```

No new tables needed. All data already exists — this is purely a query surface.

## Tasks

### 1. Implement `search_items` RPC

Create the Supabase RPC function that the MCP tool already calls. Use the existing `match_items` embedding function with keyword fallback.

**Input:** `search_query text, result_limit int`
**Returns:** `id, item_number, title, summary, domain, content_type, tags, source_url, similarity`

### 2. Implement `search_items_in_container` RPC

Same as above but filtered by container UUID via `container_items` join.

**Input:** `search_query text, container_uuid uuid, result_limit int`

### 3. Create `get_item_content` RPC

Expose full item content for deep reads. Returns transcript, extracted entities, and GitHub metadata — everything the classifier and pipeline captured.

**Input:** `item_uuid uuid`
**Returns:** `id, title, summary, transcript, extracted_entities, github_metadata, source_url, tags, domain`

### 4. Add `get_mollymemo_item` MCP tool to Sidespace

New tool on the Sidespace MCP server that calls `get_item_content` RPC. Lets Hoshi read the full article/transcript when it needs deep context.

### 5. Create `get_user_interests` RPC

Expose the interest graph with ranked, time-decayed weights.

**Input:** `interest_limit int, interest_type_filter text (optional)`
**Returns:** `interest_type, value, weight, occurrence_count, first_seen, last_seen`
**Order:** `weight DESC, occurrence_count DESC`

### 6. Add `get_mollymemo_interests` MCP tool to Sidespace

New tool on the Sidespace MCP server. Lets Hoshi ask "what are Matt's current interests?" and get a ranked list.

### 7. Create `find_related_items` RPC

Given an item UUID, find the N most semantically similar items using pgvector cosine similarity.

**Input:** `item_uuid uuid, result_limit int`
**Returns:** `id, item_number, title, summary, tags, source_url, similarity`

### 8. Add `find_related_items` MCP tool to Sidespace

New tool that calls the RPC. Lets Hoshi discover connections: "You saved 4 things about coding agents this week."

### 9. End-to-end verification

Test each tool from Hoshi chat:
- Search for a known item, read its full content
- Query interest graph, verify ranking makes sense
- Find related items for a recent capture
- Verify container-filtered search works
