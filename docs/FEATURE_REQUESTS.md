# Feature Requests

## UI/UX

### 1. Improve link visibility
**Priority:** High
**Status:** Done

~~Links are the same color as text, making them hard to differentiate.~~

**Solution:** Added `--link` and `--link-hover` CSS variables with orange color. Theme-friendly - just update the variables to change link colors globally.

---

## Data Processing

### 2. Surface extracted GitHub repos in UI
**Priority:** Medium
**Status:** Partially implemented

GitHub URLs mentioned in TikTok transcripts are already extracted and stored in `extracted_entities.repos`. Need to:
- [ ] Display extracted repos prominently in the item card
- [ ] Consider adding a dedicated `github_url` field for the primary repo
- [ ] Show repo metadata (stars, description) inline

---

## System Extensibility

### 3. Add new domains (e.g., robotics)
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

## Notes

- The system works for any topic - just add domains to the classifier prompt
- Auto-categorization is handled by GPT-4o Mini based on transcript/content analysis
