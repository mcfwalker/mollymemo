# Feature Requests

## Open Requests

### 1. YouTube support
**Priority:** Medium
**Status:** Open

Add YouTube video processing. Considerations:
- **Cost:** YouTube videos can be long-form (10min-2hr+). Transcription costs scale with duration.
- **Existing transcripts:** Many YouTube videos have auto-generated or creator-provided captions. Should check for existing transcripts via YouTube API before transcribing.
- **Options:**
  - Use YouTube captions API (free, may have quality issues)
  - Use Whisper/OpenAI transcription (costly for long videos)
  - Hybrid: try captions first, fall back to transcription
- **Rate limits:** YouTube API has quotas

---

### 2. Add new domains (e.g., robotics)
**Priority:** Low
**Status:** Open

The classifier currently supports:
- `vibe-coding` - software dev, AI coding tools
- `ai-filmmaking` - video generation, AI video
- `other` - catch-all

To add new domains:
1. Edit `src/lib/processors/classifier.ts`
2. Add domain to the prompt with description
3. Update any UI filters

The AI handles categorization automatically based on content.

---

### 3. Show repo metadata inline
**Priority:** Low
**Status:** Open

Enhancement to the GitHub repo display:
- [ ] Consider adding a dedicated `github_url` field for the primary repo
- [ ] Show repo metadata (stars, description) inline in item cards

GitHub URLs are already extracted and stored in `extracted_entities.repos`.

---

## Completed

### Link visibility
~~Links are the same color as text, making them hard to differentiate.~~

**Solution:** Added `--link` and `--link-hover` CSS variables with orange color. Theme-friendly.

---

### Yellow text contrast (light theme)
~~Yellow text has poor contrast on light backgrounds.~~

**Solution:** Added `--warning-foreground` CSS variable. Contrast improved to WCAG AA compliant.

---

### Capture UX
~~Some posts take a long time to process.~~

**Solution:** Processing runs in background after instant DB insert. Telegram bot provides immediate "Got it!" feedback and sends completion message.

---

### Universal capture mechanism
~~Allow capturing via text message or WhatsApp.~~

**Solution:** Telegram bot is the primary capture method. Send links directly to @MollyMemoBot.

---

### Cost tracking
~~Add visibility into API spending.~~

**Solution:** Per-item cost tracking for OpenAI, Grok, and repo extraction. Stored in items table.

---

### Surface extracted GitHub repos
~~Display extracted repos in UI.~~

**Solution:** GitHub repos displayed in expanded item cards under "Extracted Repos" section.

---

## Notes

- The system works for any topic - just add domains to the classifier prompt
- Auto-categorization is handled by GPT-4o Mini based on transcript/content analysis
