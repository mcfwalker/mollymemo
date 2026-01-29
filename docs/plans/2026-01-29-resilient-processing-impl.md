# Resilient Processing Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fire-and-forget `after()` callbacks with Inngest for reliable job processing, plus Sentry for error tracking.

**Architecture:** Telegram webhook inserts item and sends Inngest event. Inngest function runs processing in steps (extract → classify → save → notify). Failures captured to Sentry with full context.

**Tech Stack:** Inngest (job orchestration), Sentry (error tracking), Next.js 15, Supabase, vitest

**Design Doc:** `docs/plans/2026-01-29-resilient-processing-pipeline.md`

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install Inngest and Sentry packages**

Run:
```bash
npm install inngest @sentry/nextjs
```

**Step 2: Verify installation**

Run:
```bash
npm ls inngest @sentry/nextjs
```

Expected: Both packages listed with versions

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add inngest and sentry"
```

---

## Task 2: Configure Sentry

**Files:**
- Create: `sentry.client.config.ts`
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Modify: `next.config.ts`
- Modify: `.env.example`

**Step 1: Run Sentry wizard**

Run:
```bash
npx @sentry/wizard@latest -i nextjs
```

This creates the config files and modifies next.config.ts. Follow prompts:
- Select project or create new one
- Accept default file locations

**Step 2: Verify sentry.client.config.ts exists**

Check that it contains:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
});
```

**Step 3: Update .env.example with Sentry vars**

Add to `.env.example`:
```bash
# Sentry (error tracking)
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=sntrys_xxx
```

**Step 4: Commit**

```bash
git add sentry.*.config.ts next.config.ts .env.example .sentryclirc
git commit -m "feat: configure sentry for error tracking"
```

---

## Task 3: Create Inngest Client

**Files:**
- Create: `src/inngest/client.ts`

**Step 1: Create Inngest client**

Create `src/inngest/client.ts`:
```typescript
import { Inngest } from "inngest";

// Create Inngest client
// Event types will be inferred from usage
export const inngest = new Inngest({
  id: "mollymemo",
  // Sentry integration for error tracking
});
```

**Step 2: Commit**

```bash
git add src/inngest/client.ts
git commit -m "feat: create inngest client"
```

---

## Task 4: Create Process Item Function

**Files:**
- Create: `src/inngest/functions/process-item.ts`
- Reference: `src/lib/processors/index.ts` (read-only, for understanding)

**Step 1: Create the process-item function with steps**

Create `src/inngest/functions/process-item.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";
import { inngest } from "../client";
import { createServiceClient, Item } from "@/lib/supabase";
import { detectSourceType } from "@/lib/processors/detect";
import { processGitHub } from "@/lib/processors/github";
import { processTikTok } from "@/lib/processors/tiktok";
import { processX } from "@/lib/processors/x";
import {
  extractReposFromTranscript,
  extractReposFromSummary,
} from "@/lib/processors/repo-extractor";
import { classify } from "@/lib/processors/classifier";
import { sendMessage } from "@/lib/telegram";

// Event type for item capture
type ItemCapturedEvent = {
  name: "item/captured";
  data: {
    itemId: string;
    sourceType: string;
    sourceUrl: string;
    userId: string;
    chatId?: number; // Optional - only present for Telegram captures
  };
};

export const processItem = inngest.createFunction(
  {
    id: "process-item",
    retries: 3,
    onFailure: async ({ error, event }) => {
      const { itemId, sourceType, sourceUrl, chatId } =
        event.data as ItemCapturedEvent["data"];

      // Capture to Sentry with context
      Sentry.captureException(error, {
        tags: {
          processor: sourceType,
          itemId: itemId,
        },
        extra: {
          sourceUrl: sourceUrl,
          eventData: event.data,
        },
      });

      // Update item with failure status
      const supabase = createServiceClient();
      await supabase
        .from("items")
        .update({
          status: "failed",
          error_message:
            error instanceof Error ? error.message : "Unknown error",
        })
        .eq("id", itemId);

      // Notify user if this was a Telegram capture
      if (chatId) {
        await sendMessage(chatId, "Failed to process - check the web app");
      }
    },
  },
  { event: "item/captured" },
  async ({ event, step }) => {
    const { itemId, sourceType, chatId } = event.data as ItemCapturedEvent["data"];
    const supabase = createServiceClient();

    // Step 1: Mark as processing
    await step.run("mark-processing", async () => {
      await supabase
        .from("items")
        .update({ status: "processing" })
        .eq("id", itemId);
    });

    // Step 2: Fetch item
    const item = await step.run("fetch-item", async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*")
        .eq("id", itemId)
        .single();

      if (error || !data) {
        throw new Error(`Failed to fetch item: ${error?.message}`);
      }
      return data as Item;
    });

    // Step 3: Extract content based on source type
    const extracted = await step.run("extract-content", async () => {
      let transcript: string | undefined;
      let githubMetadata: Awaited<ReturnType<typeof processGitHub>> = null;
      let extractedEntities: Item["extracted_entities"] = {
        repos: [],
        tools: [],
        techniques: [],
      };
      let grokCost = 0;
      let repoExtractionCost = 0;

      if (sourceType === "tiktok") {
        const result = await processTikTok(item.source_url);
        if (!result || !result.transcript) {
          throw new Error("TikTok transcription failed - no transcript returned");
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
      } else if (sourceType === "github") {
        githubMetadata = await processGitHub(item.source_url);
        if (!githubMetadata) {
          throw new Error("GitHub metadata fetch failed");
        }
      } else if (sourceType === "x") {
        const xData = await processX(item.source_url);
        if (!xData) {
          throw new Error("X/Twitter fetch failed");
        }
        grokCost = xData.grokCost;

        if (xData.videoTranscript) {
          transcript = `[Post]: ${xData.text}\n\n[Video Transcript]: ${xData.videoTranscript}`;
        } else {
          transcript = xData.text;
        }

        // Handle X Articles (login required)
        if (!xData.usedGrok && xData.xArticleUrl) {
          return {
            isXArticle: true,
            xData,
            grokCost,
          };
        }

        // Process resolved URLs for GitHub repos
        const urlsToCheck = xData.usedGrok
          ? xData.resolvedUrls
          : [
              ...xData.resolvedUrls,
              ...(xData.text.match(/github\.com\/[^\s)]+/g) || []).map((u: string) =>
                u.startsWith("http") ? u : `https://${u}`
              ),
            ];

        for (const url of urlsToCheck.slice(0, 3)) {
          if (url.includes("github.com") && !extractedEntities.repos?.includes(url)) {
            const gh = await processGitHub(url);
            if (gh) {
              extractedEntities.repos?.push(url);
              if (!githubMetadata) githubMetadata = gh;
            }
          }
        }

        // Smart extraction if no repos found
        if (transcript && extractedEntities.repos?.length === 0) {
          const { repos, cost } = await extractReposFromTranscript(
            transcript,
            extractedEntities.repos || []
          );
          repoExtractionCost += cost;
          for (const repo of repos.slice(0, 3)) {
            if (!extractedEntities.repos?.includes(repo.url)) {
              const gh = await processGitHub(repo.url);
              if (gh) {
                extractedEntities.repos?.push(repo.url);
                if (!githubMetadata) githubMetadata = gh;
              }
            }
          }
        }
      } else if (sourceType === "article") {
        const { processArticle } = await import("@/lib/processors/article");
        const articleData = await processArticle(item.source_url);
        if (articleData && articleData.content) {
          transcript = articleData.content;
          const githubUrls = articleData.content.match(/github\.com\/[^\s)]+/g) || [];
          for (const ghUrl of githubUrls.slice(0, 3)) {
            const fullUrl = ghUrl.startsWith("http") ? ghUrl : `https://${ghUrl}`;
            if (!extractedEntities.repos?.includes(fullUrl)) {
              const gh = await processGitHub(fullUrl);
              if (gh) {
                extractedEntities.repos?.push(fullUrl);
                if (!githubMetadata) githubMetadata = gh;
              }
            }
          }
        }
      }

      return {
        transcript,
        githubMetadata,
        extractedEntities,
        grokCost,
        repoExtractionCost,
      };
    });

    // Handle X Articles early return
    if ("isXArticle" in extracted && extracted.isXArticle) {
      await step.run("save-x-article", async () => {
        const { xData, grokCost } = extracted;
        await supabase
          .from("items")
          .update({
            status: "processed",
            processed_at: new Date().toISOString(),
            title: `@${xData.authorName} shared: X Article (login required)`,
            summary: `X Article shared by ${xData.authorName}. Content requires X login to view.`,
            transcript: `Resolved URL: ${xData.xArticleUrl}`,
            content_type: "resource",
            extracted_entities: { repos: [], tools: [], techniques: [] },
            raw_data: { xData, xArticleUrl: xData.xArticleUrl },
            openai_cost: null,
            grok_cost: grokCost || null,
          })
          .eq("id", itemId);
      });

      if (chatId) {
        await step.run("notify-x-article", async () => {
          await sendMessage(chatId, "✓ X Article captured (login required to view content)");
        });
      }
      return { status: "processed", type: "x-article" };
    }

    // Step 4: Classify content
    const classification = await step.run("classify", async () => {
      const result = await classify({
        sourceType,
        transcript: extracted.transcript,
        githubMetadata: extracted.githubMetadata || undefined,
      });
      return result;
    });

    // Step 5: Second pass repo extraction from summary
    const finalExtracted = await step.run("extract-repos-from-summary", async () => {
      let { extractedEntities, githubMetadata, repoExtractionCost } = extracted;

      if (
        classification &&
        extractedEntities.repos?.length === 0 &&
        classification.title &&
        classification.summary
      ) {
        const { repos, cost } = await extractReposFromSummary(
          classification.title,
          classification.summary,
          extractedEntities.repos || []
        );
        repoExtractionCost += cost;

        for (const repo of repos.slice(0, 3)) {
          const gh = await processGitHub(repo.url);
          if (gh) {
            extractedEntities.repos?.push(repo.url);
            if (!githubMetadata) githubMetadata = gh;
          }
        }
      }

      return { extractedEntities, githubMetadata, repoExtractionCost };
    });

    // Step 6: Save results
    await step.run("save-results", async () => {
      const updates: Partial<Item> = {
        status: "processed",
        processed_at: new Date().toISOString(),
        transcript: extracted.transcript || null,
        extracted_entities: finalExtracted.extractedEntities,
        raw_data: {
          githubMetadata: finalExtracted.githubMetadata,
          transcript: extracted.transcript,
        },
        openai_cost: classification?.cost || null,
        grok_cost: extracted.grokCost || null,
        repo_extraction_cost: finalExtracted.repoExtractionCost || null,
      };

      if (classification) {
        updates.title = classification.title;
        updates.summary = classification.summary;
        updates.domain = classification.domain;
        updates.content_type = classification.content_type as Item["content_type"];
        updates.tags = classification.tags;
      }

      if (finalExtracted.githubMetadata) {
        if (sourceType === "github") {
          updates.github_url = item.source_url;
        } else if (
          finalExtracted.extractedEntities.repos &&
          finalExtracted.extractedEntities.repos.length > 0
        ) {
          updates.github_url = finalExtracted.extractedEntities.repos[0];
        }
        updates.github_metadata = {
          stars: finalExtracted.githubMetadata.stars,
          language: finalExtracted.githubMetadata.language || undefined,
          description: finalExtracted.githubMetadata.description || undefined,
          topics: finalExtracted.githubMetadata.topics,
        };
        if (!updates.title) {
          updates.title = finalExtracted.githubMetadata.name;
        }
      }

      await supabase.from("items").update(updates).eq("id", itemId);
    });

    // Step 7: Notify user (if Telegram capture)
    if (chatId) {
      await step.run("notify-user", async () => {
        const { data: processed } = await supabase
          .from("items")
          .select("title, summary")
          .eq("id", itemId)
          .single();

        if (processed) {
          const title = processed.title || "Untitled";
          const summary = processed.summary
            ? `\n${processed.summary.slice(0, 200)}${processed.summary.length > 200 ? "..." : ""}`
            : "";
          await sendMessage(chatId, `✓ ${title}${summary}`);
        }
      });
    }

    return { status: "processed", itemId };
  }
);
```

**Step 2: Commit**

```bash
git add src/inngest/functions/process-item.ts
git commit -m "feat: create inngest process-item function with steps"
```

---

## Task 5: Create Inngest Functions Index

**Files:**
- Create: `src/inngest/functions/index.ts`

**Step 1: Create index file exporting all functions**

Create `src/inngest/functions/index.ts`:
```typescript
import { processItem } from "./process-item";

// Export all Inngest functions for the serve handler
export const functions = [processItem];
```

**Step 2: Commit**

```bash
git add src/inngest/functions/index.ts
git commit -m "feat: create inngest functions index"
```

---

## Task 6: Create Inngest API Route

**Files:**
- Create: `src/app/api/inngest/route.ts`

**Step 1: Create the Inngest serve endpoint**

Create `src/app/api/inngest/route.ts`:
```typescript
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Create the Inngest serve handler
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
```

**Step 2: Commit**

```bash
git add src/app/api/inngest/route.ts
git commit -m "feat: create inngest api route"
```

---

## Task 7: Update Environment Variables

**Files:**
- Modify: `.env.example`
- Modify: `.env.local` (manually - contains secrets)

**Step 1: Add Inngest vars to .env.example**

Add to `.env.example`:
```bash
# Inngest (job orchestration)
INNGEST_EVENT_KEY=your_inngest_event_key
INNGEST_SIGNING_KEY=your_inngest_signing_key
```

**Step 2: Get Inngest keys**

1. Go to https://app.inngest.com
2. Create project "mollymemo" if not exists
3. Copy Event Key and Signing Key from project settings

**Step 3: Add to .env.local**

Add the actual keys to `.env.local` (do not commit):
```bash
INNGEST_EVENT_KEY=<your_actual_key>
INNGEST_SIGNING_KEY=<your_actual_key>
```

**Step 4: Commit .env.example only**

```bash
git add .env.example
git commit -m "docs: add inngest env vars to example"
```

---

## Task 8: Update Telegram Webhook

**Files:**
- Modify: `src/app/api/telegram/route.ts`

**Step 1: Add Inngest import**

At top of file, add:
```typescript
import { inngest } from "@/inngest/client";
```

**Step 2: Remove after() import**

Change:
```typescript
import { NextRequest, NextResponse, after } from 'next/server'
```

To:
```typescript
import { NextRequest, NextResponse } from 'next/server'
```

**Step 3: Replace after() callback with inngest.send()**

Find this block (around line 264-309):
```typescript
    // Send immediate acknowledgment
    await sendMessage(chatId, 'Got it! Processing...')

    // Process and send follow-up after response
    after(async () => {
      try {
        await processItem(item.id)
        // ... rest of callback
      } catch (err) {
        // ... error handling
      }
    })

    return NextResponse.json({ ok: true })
```

Replace with:
```typescript
    // Send immediate acknowledgment
    await sendMessage(chatId, 'Got it! Processing...')

    // Send event to Inngest for processing
    await inngest.send({
      name: "item/captured",
      data: {
        itemId: item.id,
        sourceType: sourceType,
        sourceUrl: parsedUrl.href,
        userId: user.id,
        chatId: chatId,
      },
    });

    return NextResponse.json({ ok: true })
```

**Step 4: Remove unused processItem import**

Remove this line:
```typescript
import { processItem } from '@/lib/processors'
```

**Step 5: Commit**

```bash
git add src/app/api/telegram/route.ts
git commit -m "refactor: use inngest for telegram webhook processing"
```

---

## Task 9: Update Retry Endpoint

**Files:**
- Modify: `src/app/api/items/[id]/route.ts`

**Step 1: Add Inngest import**

At top of file, add:
```typescript
import { inngest } from "@/inngest/client";
```

**Step 2: Replace fire-and-forget processItem with inngest.send()**

Find the POST handler (around line 149-190). Replace:
```typescript
  // Fire-and-forget: process in background
  processItem(id).catch(err => {
    console.error('Reprocess error:', err)
  })

  return NextResponse.json({
    id,
    status: 'reprocessing',
    message: 'Item queued for reprocessing',
  })
```

With:
```typescript
  // Get item details for the event
  const { data: itemDetails } = await supabase
    .from('items')
    .select('source_type, source_url, user_id')
    .eq('id', id)
    .single()

  if (!itemDetails) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  // Send to Inngest for processing
  await inngest.send({
    name: "item/captured",
    data: {
      itemId: id,
      sourceType: itemDetails.source_type,
      sourceUrl: itemDetails.source_url,
      userId: itemDetails.user_id,
      // No chatId - retry doesn't send Telegram notification
    },
  });

  return NextResponse.json({
    id,
    status: 'reprocessing',
    message: 'Item queued for reprocessing',
  })
```

**Step 3: Remove unused processItem import**

Remove this line:
```typescript
import { processItem } from '@/lib/processors'
```

**Step 4: Commit**

```bash
git add src/app/api/items/[id]/route.ts
git commit -m "refactor: use inngest for item retry processing"
```

---

## Task 10: Test Locally with Inngest Dev Server

**Files:**
- None (manual testing)

**Step 1: Start Inngest dev server**

In a terminal:
```bash
npx inngest-cli@latest dev
```

This starts the Inngest dev server at http://localhost:8288

**Step 2: Start Next.js dev server**

In another terminal:
```bash
npm run dev
```

**Step 3: Verify Inngest connects**

Open http://localhost:8288 and verify:
- "mollymemo" app appears
- "process-item" function is listed

**Step 4: Test with a real item**

Option A - Use Telegram bot to send a link
Option B - Use retry button in web app on an existing item

**Step 5: Verify in Inngest dashboard**

Check http://localhost:8288:
- Event "item/captured" appears
- Function run shows all steps
- Each step shows timing and status

---

## Task 11: Test Sentry Error Capture

**Files:**
- None (manual testing)

**Step 1: Trigger a deliberate failure**

Create a test item with an invalid URL that will fail processing:
```sql
-- Run in Supabase SQL editor
INSERT INTO items (source_url, source_type, status, user_id)
VALUES ('https://invalid-url-that-will-fail.fake/test', 'article', 'pending', '<your_user_id>')
RETURNING id;
```

**Step 2: Trigger processing via retry**

Use the retry button or call:
```bash
curl -X POST http://localhost:3000/api/items/<item_id> \
  -H "x-user-id: <your_user_id>"
```

**Step 3: Verify Sentry receives error**

Check Sentry dashboard:
- Error appears with tag `processor: article`
- Extra context includes `sourceUrl` and `itemId`

---

## Task 12: Deploy to Vercel

**Files:**
- None (deployment)

**Step 1: Add environment variables to Vercel**

In Vercel project settings, add:
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`

**Step 2: Deploy**

```bash
git push origin main
```

Or if on a branch:
```bash
git push origin feature/inngest-pipeline
```

**Step 3: Configure Inngest production**

1. Go to https://app.inngest.com
2. Add production app URL: `https://mollymemo.com/api/inngest`
3. Verify webhook is connected

**Step 4: Test production**

Send a real link via Telegram bot and verify:
- Item processes successfully
- Inngest dashboard shows the run
- No errors in Sentry

---

## Task 13: Cleanup Old Code (Optional)

**Files:**
- Modify: `src/lib/processors/index.ts`

The `processItem` function in `src/lib/processors/index.ts` is no longer called directly. You can either:

A. **Keep it** - Useful for local testing/debugging outside Inngest
B. **Remove it** - Cleaner, but loses standalone testing ability

Recommendation: Keep for now, add a comment noting it's called from Inngest.

**Step 1: Add comment to processItem**

At top of `processItem` function:
```typescript
/**
 * Process an item through the extraction and classification pipeline.
 *
 * NOTE: This function is called from the Inngest process-item function.
 * Do not call directly from route handlers - use inngest.send() instead.
 */
export async function processItem(itemId: string): Promise<void> {
```

**Step 2: Commit**

```bash
git add src/lib/processors/index.ts
git commit -m "docs: add note about inngest usage to processItem"
```

---

## Summary

After completing all tasks:

1. **Inngest handles all item processing** - Reliable job orchestration with steps
2. **Sentry captures all errors** - With context (item ID, source type, URL)
3. **No more stuck items** - Inngest tracks state; failures are explicit
4. **Full visibility** - Inngest dashboard shows every step's timing and status
5. **Automatic retries** - 3 attempts with exponential backoff before failure

**Verification checklist:**
- [ ] Inngest dev server connects locally
- [ ] Test item processes through all steps
- [ ] Failed item shows in Sentry with context
- [ ] Production deployment connects to Inngest
- [ ] Real Telegram capture works end-to-end
