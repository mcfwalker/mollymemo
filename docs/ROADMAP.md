# MollyMemo Roadmap

## High Priority

### YouTube Processor
**Complexity:** Medium

Extract from YouTube URLs:
- Video title, description, channel
- Transcript via YouTube API (free) or Whisper (costly for long videos)
- Chapter markers if available
- Hybrid approach: try captions first, fall back to transcription

---

## Medium Priority

### RAG-Powered Memory
**Complexity:** High

Evolve Molly's memory beyond the simple `molly_context` field:
- Embed past digests and items using OpenAI embeddings
- Store in Supabase pgvector
- RAG retrieval: "Two weeks ago you saved something similar..."
- Pattern detection: "You've saved 5 mapping tools this month"

**Trigger:** When KB grows beyond ~100 items per user

### Vector Search
**Complexity:** Medium

When items exceed ~500:
- Embed items on capture
- pgvector similarity search
- Power both MollyMemo skill and digest references

### Error Monitoring
**Complexity:** Low

Add Sentry or similar:
- Track runtime errors
- Alert on anomalies
- Performance monitoring

---

## Low Priority

### New Classifier Domains
**Complexity:** Low

Add domains beyond vibe-coding/ai-filmmaking:
1. Edit `src/lib/processors/classifier.ts`
2. Add domain to prompt with description
3. Update UI filters if needed

### Repo Metadata Display
**Complexity:** Low

Show GitHub repo details inline:
- Stars, description in item cards
- Dedicated `github_url` field for primary repo

### Feedback Collection
**Complexity:** Low

Let users reply to digest voice messages:
- Voice reply → transcribe → store as feedback
- Text reply → store directly
- Use feedback to tune future digests

### Web Player Fallback
**Complexity:** Medium

`/digest/[id]` page with:
- Audio player
- Transcript display
- Optional link in Telegram message

### Smart Deduplication
**Complexity:** Low

Detect near-duplicate items:
- Same URL with different query params
- Same repo linked from different tweets
- Merge or flag for user

### Distributed Rate Limiting
**Complexity:** Low

Replace in-memory rate limiting with Upstash Redis:
- Persist across cold starts
- Scale across multiple instances

### Braintrust Integration
**Complexity:** Medium

Observability for digest quality:
- Log all script generation calls
- Track quality scores over time
- A/B test prompt variations

---

## Ideas

### Newsletter/Email Capture
**Complexity:** High

Forward emails to MollyMemo:
- Parse email content
- Extract links
- Summarize key points
