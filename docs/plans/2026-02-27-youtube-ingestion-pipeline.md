# YouTube Ingestion Pipeline (MOL-10) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add YouTube video ingestion to MollyMemo — extract transcripts/captions, metadata, and GitHub URLs from YouTube videos shared via Telegram or Chrome extension.

**Architecture:** Use the `youtube-transcript` npm package to fetch auto-generated captions (no API key needed), YouTube oEmbed API for metadata (title, author), and parse video IDs from all common URL formats. Falls back to oEmbed title when no captions exist. Follows the exact same pattern as the TikTok processor — returns transcript + extracted URLs + cost.

**Tech Stack:** `youtube-transcript` (caption extraction), YouTube oEmbed API (metadata), Vitest (tests)

---

### Task 1: Install youtube-transcript dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

Run: `npm install youtube-transcript`

**Step 2: Verify installation**

Run: `cat package.json | grep youtube-transcript`
Expected: `"youtube-transcript": "^X.X.X"` in dependencies

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add youtube-transcript dependency for MOL-10"
```

---

### Task 2: Create YouTube processor with tests (TDD)

**Files:**
- Create: `src/lib/processors/youtube.ts`
- Create: `src/lib/processors/youtube.test.ts`

**Context:** Follow the TikTok processor pattern exactly. The processor:
1. Parses the video ID from various YouTube URL formats
2. Fetches metadata via oEmbed API (title, author — no API key needed)
3. Fetches transcript via `youtube-transcript` package (auto-generated captions)
4. Falls back to oEmbed title if no transcript available
5. Extracts GitHub URLs from transcript text
6. Returns `{ transcript, extractedUrls, repoExtractionCost }`

**YouTube URL formats to support:**
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtube.com/watch?v=VIDEO_ID`
- `https://m.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/live/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- URLs with extra params like `&t=120` or `&list=PLxxx`

**Step 1: Write the test file**

```typescript
// src/lib/processors/youtube.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { processYouTube, parseYouTubeVideoId } from './youtube'

// Mock youtube-transcript
vi.mock('youtube-transcript', () => ({
  YoutubeTranscript: {
    fetchTranscript: vi.fn(),
  },
}))

// Mock repo-extractor
vi.mock('./repo-extractor', () => ({
  extractReposFromTranscript: vi.fn().mockResolvedValue({
    repos: [{ url: 'https://github.com/extracted/repo' }],
    cost: 0.001,
  }),
}))

import { YoutubeTranscript } from 'youtube-transcript'
import { extractReposFromTranscript } from './repo-extractor'

describe('parseYouTubeVideoId', () => {
  it('parses standard watch URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses short URLs', () => {
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses shorts URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses live URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('parses embed URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('strips extra query params', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-YouTube URLs', () => {
    expect(parseYouTubeVideoId('https://vimeo.com/12345')).toBeNull()
    expect(parseYouTubeVideoId('https://example.com')).toBeNull()
  })

  it('returns null for YouTube URLs without video ID', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/')).toBeNull()
    expect(parseYouTubeVideoId('https://www.youtube.com/channel/UCxxx')).toBeNull()
  })
})

describe('processYouTube', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('processes YouTube video with transcript', async () => {
    // Mock oEmbed metadata
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Test Video Title',
        author_name: 'Test Author',
        author_url: 'https://www.youtube.com/@testauthor',
      }),
    })

    // Mock transcript fetch
    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Hello everyone, today we look at', duration: 5, offset: 0, lang: 'en' },
      { text: 'this amazing tool on github.com/user/repo', duration: 5, offset: 5, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result).not.toBeNull()
    expect(result!.transcript).toContain('Hello everyone')
    expect(result!.transcript).toContain('github.com/user/repo')
    expect(result!.extractedUrls).toContain('https://github.com/user/repo')
    // Explicit URL found, so smart extraction should NOT be called
    expect(extractReposFromTranscript).not.toHaveBeenCalled()
  })

  it('uses smart extraction when no GitHub URLs in transcript', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Test Video',
        author_name: 'Author',
      }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'This video talks about a cool tool', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(extractReposFromTranscript).toHaveBeenCalled()
    expect(result!.extractedUrls).toContain('https://github.com/extracted/repo')
    expect(result!.repoExtractionCost).toBe(0.001)
  })

  it('falls back to oEmbed title when transcript unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Amazing AI Tool Review',
        author_name: 'Tech Reviewer',
      }),
    })

    // Transcript fetch fails (no captions available)
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(
      new Error('Transcript is disabled')
    )

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result).not.toBeNull()
    expect(result!.transcript).toBe('[Title]: Amazing AI Tool Review\n[Author]: Tech Reviewer')
  })

  it('handles youtu.be short URLs', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ title: 'Short URL Video', author_name: 'Author' }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Content from short URL', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://youtu.be/dQw4w9WgXcQ')
    expect(result).not.toBeNull()
    expect(result!.transcript).toContain('Content from short URL')
  })

  it('returns null for invalid YouTube URLs', async () => {
    const result = await processYouTube('https://vimeo.com/12345')
    expect(result).toBeNull()
  })

  it('returns null when oEmbed fails and no transcript', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(
      new Error('Transcript is disabled')
    )

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toBeNull()
  })

  it('handles network errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.mocked(YoutubeTranscript.fetchTranscript).mockRejectedValueOnce(new Error('Network error'))

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toBeNull()
  })

  it('deduplicates extracted GitHub URLs', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ title: 'Test', author_name: 'Author' }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Check github.com/user/repo and again github.com/user/repo here', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    const repoCount = result?.extractedUrls.filter(u => u === 'https://github.com/user/repo').length
    expect(repoCount).toBe(1)
  })

  it('cleans trailing punctuation from GitHub URLs', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ title: 'Test', author_name: 'Author' }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Go to github.com/user/repo, or check github.com/org/tool.', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(result?.extractedUrls).toContain('https://github.com/user/repo')
    expect(result?.extractedUrls).toContain('https://github.com/org/tool')
    expect(result?.extractedUrls).not.toContain('https://github.com/user/repo,')
    expect(result?.extractedUrls).not.toContain('https://github.com/org/tool.')
  })

  it('includes oEmbed metadata in raw transcript', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        title: 'Video Title',
        author_name: 'Channel Name',
      }),
    })

    vi.mocked(YoutubeTranscript.fetchTranscript).mockResolvedValueOnce([
      { text: 'Transcript text here', duration: 5, offset: 0, lang: 'en' },
    ])

    const result = await processYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    // Transcript should include metadata header for classifier context
    expect(result!.transcript).toContain('Video Title')
    expect(result!.transcript).toContain('Channel Name')
    expect(result!.transcript).toContain('Transcript text here')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/processors/youtube.test.ts`
Expected: FAIL — `youtube.ts` doesn't exist yet

**Step 3: Write the YouTube processor**

```typescript
// src/lib/processors/youtube.ts
// YouTube processor - extracts transcripts and metadata from YouTube videos

import { YoutubeTranscript } from 'youtube-transcript'
import { extractReposFromTranscript } from './repo-extractor'

interface YouTubeResult {
  transcript: string
  extractedUrls: string[]
  repoExtractionCost: number
}

/**
 * Parse a YouTube video ID from various URL formats:
 * - youtube.com/watch?v=ID
 * - youtu.be/ID
 * - youtube.com/shorts/ID
 * - youtube.com/live/ID
 * - youtube.com/embed/ID
 */
export function parseYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()

    // youtu.be/VIDEO_ID
    if (hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0]
      return id || null
    }

    // Must be youtube.com domain
    if (!hostname.includes('youtube.com')) return null

    // youtube.com/watch?v=VIDEO_ID
    const vParam = parsed.searchParams.get('v')
    if (vParam) return vParam

    // youtube.com/shorts/ID, /live/ID, /embed/ID
    const pathMatch = parsed.pathname.match(/^\/(shorts|live|embed)\/([^/?]+)/)
    if (pathMatch) return pathMatch[2]

    return null
  } catch {
    return null
  }
}

/**
 * Fetch video metadata via YouTube oEmbed API (no API key needed).
 * Returns title and author, or null on failure.
 */
async function fetchOEmbedMetadata(
  url: string
): Promise<{ title: string; authorName: string } | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    const response = await fetch(oembedUrl)
    if (!response.ok) return null

    const data = await response.json()
    return {
      title: data.title || 'Untitled',
      authorName: data.author_name || 'Unknown',
    }
  } catch {
    return null
  }
}

/**
 * Fetch transcript captions via youtube-transcript package.
 * Returns joined text, or null if captions unavailable.
 */
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    if (!segments || segments.length === 0) return null
    return segments.map((s) => s.text).join(' ')
  } catch {
    return null
  }
}

export async function processYouTube(url: string): Promise<YouTubeResult | null> {
  const videoId = parseYouTubeVideoId(url)
  if (!videoId) {
    console.error('Could not parse YouTube video ID from URL:', url)
    return null
  }

  try {
    // Fetch metadata and transcript in parallel
    const [metadata, transcript] = await Promise.all([
      fetchOEmbedMetadata(url),
      fetchTranscript(videoId),
    ])

    // Build the full transcript string
    let fullTranscript: string | null = null

    if (transcript) {
      // Include metadata header for classifier context
      const header = metadata
        ? `[Title]: ${metadata.title}\n[Author]: ${metadata.authorName}\n\n`
        : ''
      fullTranscript = `${header}[Transcript]: ${transcript}`
    } else if (metadata) {
      // Fallback: use title/author when no captions
      console.log('No transcript available, using oEmbed metadata as fallback')
      fullTranscript = `[Title]: ${metadata.title}\n[Author]: ${metadata.authorName}`
    }

    if (!fullTranscript) {
      console.error('No transcript or metadata available for YouTube video:', videoId)
      return null
    }

    // Extract explicit GitHub URLs from transcript
    const githubUrlPattern = /github\.com\/[^\s"'<>,.]+/gi
    const urlMatches = fullTranscript.match(githubUrlPattern) || []
    const explicitUrls = [
      ...new Set(
        urlMatches.map(
          (m: string) => `https://${m.replace(/[.,;:!?)]+$/, '')}`
        )
      ),
    ]

    // Smart extraction if no explicit GitHub URLs found (skip for metadata-only fallback)
    let extractedUrls = explicitUrls
    let repoExtractionCost = 0
    if (explicitUrls.length === 0 && transcript) {
      const { repos, cost } = await extractReposFromTranscript(fullTranscript)
      extractedUrls = repos.map((r) => r.url)
      repoExtractionCost = cost
    }

    return {
      transcript: fullTranscript,
      extractedUrls,
      repoExtractionCost,
    }
  } catch (error) {
    console.error('YouTube processing error:', error)
    return null
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/processors/youtube.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/lib/processors/youtube.ts src/lib/processors/youtube.test.ts
git commit -m "feat(processors): add YouTube ingestion pipeline (MOL-10)"
```

---

### Task 3: Wire YouTube processor into Inngest pipeline

**Files:**
- Modify: `src/inngest/functions/process-item.ts` (add YouTube case in extract-content step)

**Context:** The `extract-content` step in `process-item.ts` has an `if/else` chain for each source type. Add a `youtube` case between the `x` and `article` cases. Follow the TikTok pattern: call `processYouTube`, throw on failure, process extracted GitHub URLs.

**Step 1: Add the import**

At top of `process-item.ts`, add:
```typescript
import { processYouTube } from "@/lib/processors/youtube";
```

**Step 2: Add the YouTube case in extract-content step**

After the `} else if (sourceType === "x") { ... }` block and before `} else if (sourceType === "article") {`, add:

```typescript
        } else if (sourceType === "youtube") {
          const result = await processYouTube(item.source_url);
          if (!result || !result.transcript) {
            throw new Error(
              "YouTube processing failed - no transcript returned"
            );
          }
          transcript = result.transcript;
          repoExtractionCost += result.repoExtractionCost;

          // Process GitHub URLs found in transcript
          for (const url of result.extractedUrls.slice(0, 3)) {
            const gh = await processGitHub(url);
            if (gh) {
              extractedEntities.repos?.push(url);
              if (!githubMetadata) githubMetadata = gh;
            }
          }
```

**Step 3: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: ALL existing tests pass + new YouTube tests pass

**Step 4: Commit**

```bash
git add src/inngest/functions/process-item.ts
git commit -m "feat(processors): wire YouTube pipeline into Inngest processing"
```

---

### Task 4: Add YouTube-specific detect tests (sanity check)

**Files:**
- Read: `src/lib/processors/detect.test.ts` (verify YouTube detection already tested)

**Context:** The detect tests already cover YouTube URLs (they were added when the `SourceType` was defined). Just verify they pass — no new code needed.

**Step 1: Run the detect tests**

Run: `npx vitest run src/lib/processors/detect.test.ts`
Expected: ALL PASS — YouTube detection was already implemented in `detect.ts`

---

### Task 5: End-to-end verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass

**Step 2: Build check**

Run: `npm run build`
Expected: Build succeeds (or fails on pre-existing Resend API key issue, which is known tech debt)

**Step 3: Final commit (if any fixes needed)**

Only if build/tests reveal issues to fix.

---

### Task 6: Deploy and live test

**Step 1: Push to main for Vercel deployment**

Run: `git push`

**Step 2: Test with a real YouTube URL via Telegram**

Send a YouTube URL to the MollyMemo Telegram bot and verify:
- Item is created with `source_type: 'youtube'`
- Transcript is extracted (from captions or fallback)
- Classification runs successfully
- Container assignment works
- Telegram notification received

**Step 3: Verify in MollyMemo web app**

Check that the processed item appears correctly on mollymemo.com with title, summary, tags, and container.
