# MollyMemo Feature Backlog

## Voice Digest Enhancements

### RAG-Powered Memory
**Priority:** Medium
**Complexity:** High

Evolve Molly's memory beyond the simple `molly_context` field:

- Embed past digests and items using OpenAI embeddings
- Store in Supabase pgvector
- RAG retrieval for contextual references: "Two weeks ago you saved something similar..."
- Pattern detection: "You've saved 5 mapping tools this month — sensing a theme?"
- Long-term preference learning

**Triggers:**
- When KB grows beyond ~100 items per user
- When simple context feels stale/repetitive

### Feedback Collection
**Priority:** Low
**Complexity:** Low

Let users reply to digest voice messages:
- Voice reply → transcribe → store as feedback
- Text reply → store directly
- Use feedback to tune future digests

### Web Player Fallback
**Priority:** Low
**Complexity:** Medium

`/digest/[id]` page with:
- Audio player
- Transcript display
- Link included in Telegram message (optional)

### Braintrust Integration
**Priority:** Low
**Complexity:** Medium

Observability for digest quality:
- Log all script generation calls
- Track quality scores over time
- A/B test prompt variations
- Monitor cost and latency

---

## Knowledge Base Enhancements

### Vector Search
**Priority:** Medium
**Complexity:** Medium

When items exceed ~500:
- Embed items on capture
- pgvector similarity search
- Power both MollyMemo skill and digest references

### Smart Deduplication
**Priority:** Low
**Complexity:** Low

Detect near-duplicate items:
- Same URL with different query params
- Same repo linked from different tweets
- Merge or flag for user

---

## Capture Enhancements

### YouTube Processor
**Priority:** Medium
**Complexity:** Medium

Extract from YouTube URLs:
- Video title, description, channel
- Transcript via YouTube API or Whisper
- Chapter markers if available

### Newsletter/Email Capture
**Priority:** Low
**Complexity:** High

Forward emails to MollyMemo:
- Parse email content
- Extract links
- Summarize key points

---

## Infrastructure

### Distributed Rate Limiting
**Priority:** Low
**Complexity:** Low

Replace in-memory rate limiting with Upstash Redis:
- Persist across cold starts
- Scale across multiple instances

### Error Monitoring
**Priority:** Medium
**Complexity:** Low

Add Sentry or similar:
- Track runtime errors
- Alert on anomalies
- Performance monitoring
