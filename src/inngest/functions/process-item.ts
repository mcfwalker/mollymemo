import { inngest } from "../client";
import { createServiceClient, Item } from "@/lib/supabase";
import { processGitHub } from "@/lib/processors/github";
import { processTikTok } from "@/lib/processors/tiktok";
import { processX } from "@/lib/processors/x";
import { processYouTube } from "@/lib/processors/youtube";
import {
  extractReposFromTranscript,
  extractReposFromSummary,
} from "@/lib/processors/repo-extractor";
import { classify } from "@/lib/processors/classifier";
import { sendMessage } from "@/lib/telegram";
import logger from "@/lib/logger";

// Type for GitHub metadata from processGitHub
type GitHubMetadata = Awaited<ReturnType<typeof processGitHub>>;

// Event data type for item capture
type ItemCapturedData = {
  itemId: string;
  sourceType: string;
  sourceUrl: string;
  userId: string;
  chatId?: number;
};

// Extraction result types
type XArticleResult = {
  isXArticle: true;
  xData: {
    authorName: string;
    xArticleUrl: string | null;
  };
  grokCost: number;
};

type NormalExtractionResult = {
  isXArticle?: false;
  transcript: string | undefined;
  githubMetadata: GitHubMetadata;
  extractedEntities: Item["extracted_entities"];
  grokCost: number;
  repoExtractionCost: number;
};

type ExtractionResult = XArticleResult | NormalExtractionResult;

export const processItem = inngest.createFunction(
  {
    id: "process-item",
    retries: 3,
    onFailure: async ({ error, event }) => {
      // event.data contains our ItemCapturedData
      const eventData = event.data as unknown as ItemCapturedData;
      const { itemId, sourceType, sourceUrl, chatId } = eventData;

      logger.error(
        { itemId, sourceType, sourceUrl, err: error instanceof Error ? error : undefined },
        'Process item failed'
      );

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
    const eventData = event.data as unknown as ItemCapturedData;
    const { itemId, sourceType, chatId } = eventData;
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
    const extracted = await step.run(
      "extract-content",
      async (): Promise<ExtractionResult> => {
        let transcript: string | undefined;
        let githubMetadata: GitHubMetadata = null;
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
            throw new Error(
              "TikTok transcription failed - no transcript returned"
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

          // Handle X Articles (login required) - early return
          if (!xData.usedGrok && xData.xArticleUrl) {
            return {
              isXArticle: true,
              xData: {
                authorName: xData.authorName,
                xArticleUrl: xData.xArticleUrl,
              },
              grokCost,
            };
          }

          // Handle link-only tweets
          if (
            !xData.usedGrok &&
            xData.isLinkOnly &&
            xData.resolvedUrls.length > 0
          ) {
            transcript = `Shared link: ${xData.resolvedUrls[0]}`;
          }

          // Process resolved URLs for GitHub repos
          const urlsToCheck = xData.usedGrok
            ? xData.resolvedUrls
            : [
                ...xData.resolvedUrls,
                ...(xData.text.match(/github\.com\/[^\s)]+/g) || []).map(
                  (u: string) => (u.startsWith("http") ? u : `https://${u}`)
                ),
              ];

          for (const url of urlsToCheck.slice(0, 3)) {
            if (
              url.includes("github.com") &&
              !extractedEntities.repos?.includes(url)
            ) {
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
        } else if (sourceType === "article") {
          const { processArticle } = await import("@/lib/processors/article");
          const articleData = await processArticle(item.source_url);
          if (articleData && articleData.content) {
            transcript = articleData.content;
            const githubUrls =
              articleData.content.match(/github\.com\/[^\s)]+/g) || [];
            for (const ghUrl of githubUrls.slice(0, 3)) {
              const fullUrl = ghUrl.startsWith("http")
                ? ghUrl
                : `https://${ghUrl}`;
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
          isXArticle: false,
          transcript,
          githubMetadata,
          extractedEntities,
          grokCost,
          repoExtractionCost,
        };
      }
    );

    // Handle X Articles early return
    if (extracted.isXArticle === true) {
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
          await sendMessage(
            chatId,
            "✓ X Article captured (login required to view content)"
          );
        });
      }
      return { status: "processed", type: "x-article" };
    }

    // From here on, extracted is NormalExtractionResult
    const normalExtracted = extracted as NormalExtractionResult;

    // Step 4: Classify content
    const classification = await step.run("classify", async () => {
      const result = await classify({
        sourceType,
        sourceUrl: item.source_url,
        transcript: normalExtracted.transcript,
        githubMetadata: normalExtracted.githubMetadata || undefined,
      });
      return result;
    });

    // Step 5: Second pass repo extraction from summary
    const finalExtracted = await step.run(
      "extract-repos-from-summary",
      async () => {
        let extractedEntities = normalExtracted.extractedEntities;
        let githubMetadata = normalExtracted.githubMetadata;
        let repoExtractionCost = normalExtracted.repoExtractionCost;

        if (
          classification &&
          extractedEntities?.repos?.length === 0 &&
          classification.title &&
          classification.summary
        ) {
          const { repos, cost } = await extractReposFromSummary(
            classification.title,
            classification.summary,
            extractedEntities?.repos || []
          );
          repoExtractionCost += cost;

          for (const repo of repos.slice(0, 3)) {
            const gh = await processGitHub(repo.url);
            if (gh) {
              extractedEntities?.repos?.push(repo.url);
              if (!githubMetadata) githubMetadata = gh;
            }
          }
        }

        return { extractedEntities, githubMetadata, repoExtractionCost };
      }
    );

    // Step 6: Save results
    await step.run("save-results", async () => {
      const updates: Partial<Item> = {
        status: "processed",
        processed_at: new Date().toISOString(),
        transcript: normalExtracted.transcript || null,
        extracted_entities: finalExtracted.extractedEntities,
        raw_data: {
          githubMetadata: finalExtracted.githubMetadata,
          transcript: normalExtracted.transcript,
        },
        openai_cost: classification?.cost || null,
        grok_cost: normalExtracted.grokCost || null,
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
          finalExtracted.extractedEntities?.repos &&
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

    // Step 7: Assign to containers
    const containerResult = await step.run("assign-containers", async () => {
      const { assignContainers, applyContainerAssignment } = await import("@/lib/containers");

      // Fetch the processed item
      const { data: processed } = await supabase
        .from("items")
        .select("title, summary, tags, domain, content_type, user_id")
        .eq("id", itemId)
        .single();

      if (!processed || !processed.title) {
        logger.info({ itemId }, 'Skipping container assignment - no title');
        return null;
      }

      // Fetch user's existing containers
      const { data: containers } = await supabase
        .from("containers")
        .select("id, name, description")
        .eq("user_id", processed.user_id)
        .order("updated_at", { ascending: false });

      // Fetch project anchors for filing hints
      const { data: anchors } = await supabase
        .from("project_anchors")
        .select("name, description, tags")
        .eq("user_id", processed.user_id);

      const assignment = await assignContainers(
        {
          title: processed.title,
          summary: processed.summary,
          tags: processed.tags,
          domain: processed.domain,
          content_type: processed.content_type,
        },
        containers || [],
        anchors || []
      );

      if (!assignment) {
        logger.info({ itemId }, 'Container assignment returned null');
        return null;
      }

      const result = await applyContainerAssignment(
        supabase,
        processed.user_id,
        itemId,
        assignment
      );

      logger.info(
        { itemId, containerNames: result.containerNames, cost: assignment.cost },
        'Assigned item to containers'
      );

      return {
        containerNames: result.containerNames,
        cost: assignment.cost,
      };
    });

    // Step 8: Generate embedding for semantic search (was step 7)
    await step.run("generate-embedding", async () => {
      const { embedItem } = await import("@/lib/embeddings");

      // Fetch the processed item to get final title/summary/tags
      const { data: processed } = await supabase
        .from("items")
        .select("title, summary, tags")
        .eq("id", itemId)
        .single();

      if (!processed || !processed.title) {
        logger.info({ itemId }, 'Skipping embedding - no title');
        return;
      }

      const result = await embedItem({
        title: processed.title,
        summary: processed.summary,
        tags: processed.tags,
      });

      if (result) {
        // Store embedding as array (Supabase pgvector accepts JSON array)
        await supabase
          .from("items")
          .update({
            embedding: result.embedding as unknown as string,
          })
          .eq("id", itemId);

        logger.info({ itemId, cost: result.cost }, 'Embedded item');
      }
    });

    // Step 9: Extract and store interests
    await step.run("extract-interests", async () => {
      const { extractInterests, calculateWeight } = await import("@/lib/interests");

      // Fetch the processed item
      const { data: processed } = await supabase
        .from("items")
        .select("title, summary, tags, domain, github_url, user_id")
        .eq("id", itemId)
        .single();

      if (!processed || !processed.title) {
        logger.info({ itemId }, 'Skipping interest extraction - no title');
        return;
      }

      const result = await extractInterests({
        title: processed.title,
        summary: processed.summary,
        tags: processed.tags,
        domain: processed.domain,
        github_url: processed.github_url,
      });

      if (!result || result.interests.length === 0) {
        logger.info({ itemId }, 'No interests extracted');
        return;
      }

      // Upsert each interest
      for (const interest of result.interests) {
        const { data: existing } = await supabase
          .from("user_interests")
          .select("id, occurrence_count, first_seen")
          .eq("user_id", processed.user_id)
          .eq("interest_type", interest.type)
          .eq("value", interest.value)
          .single();

        if (existing) {
          // Update existing interest
          const newCount = existing.occurrence_count + 1;
          const weight = calculateWeight(newCount, new Date());

          await supabase
            .from("user_interests")
            .update({
              occurrence_count: newCount,
              weight,
              last_seen: new Date().toISOString(),
            })
            .eq("id", existing.id);
        } else {
          // Insert new interest
          await supabase
            .from("user_interests")
            .insert({
              user_id: processed.user_id,
              interest_type: interest.type,
              value: interest.value,
              weight: 0.5,
              occurrence_count: 1,
            });
        }
      }

      logger.info({ itemId, interestCount: result.interests.length, cost: result.cost }, 'Extracted interests');
    });

    // Step 10: Notify user (if Telegram capture)
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
          const containerInfo = containerResult?.containerNames?.length
            ? `\n📂 ${containerResult.containerNames.join(", ")}`
            : "";
          await sendMessage(chatId, `✓ ${title}${summary}${containerInfo}`);
        }
      });
    }

    return { status: "processed", itemId };
  }
);
