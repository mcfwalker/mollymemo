// Proactive discovery cron - searches external sources based on user interests

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase";
import { searchHN } from "@/lib/discovery/hackernews";
import logger from "@/lib/logger";

export const discoverContent = inngest.createFunction(
  {
    id: "discover-content",
    retries: 2,
  },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    const supabase = createServiceClient();

    // Step 1: Get all users with interests
    const users = await step.run("get-users", async () => {
      const { data } = await supabase
        .from("users")
        .select("id, display_name");
      return data || [];
    });

    let totalMemos = 0;

    for (const user of users) {
      // Step 2: Get top interests for this user
      const interests = await step.run(`get-interests-${user.id}`, async () => {
        const { data } = await supabase
          .from("user_interests")
          .select("interest_type, value, weight")
          .eq("user_id", user.id)
          .order("weight", { ascending: false })
          .limit(10);
        return data || [];
      });

      if (interests.length === 0) continue;

      // Step 3: Build search queries from top topic/tool interests
      const queries = interests
        .filter((i) => i.interest_type === "topic" || i.interest_type === "tool")
        .slice(0, 5)
        .map((i) => i.value);

      if (queries.length === 0) continue;

      // Step 4: Search HN for each interest
      const discoveries = await step.run(`search-hn-${user.id}`, async () => {
        const allResults: Array<{
          query: string;
          result: Awaited<ReturnType<typeof searchHN>>[0];
        }> = [];

        for (const query of queries) {
          const results = await searchHN(query, {
            days: 7,
            minPoints: 20,
            limit: 5,
          });
          for (const result of results) {
            allResults.push({ query, result });
          }
        }

        return allResults;
      });

      // Step 5: Filter and store relevant discoveries
      const storedCount = await step.run(`store-discoveries-${user.id}`, async () => {
        // Get user's existing items to avoid duplicates
        const { data: existingItems } = await supabase
          .from("items")
          .select("source_url")
          .eq("user_id", user.id);

        const existingUrls = new Set(
          existingItems?.map((i) => i.source_url) || []
        );

        // Get existing memos to avoid duplicates
        const { data: existingMemos } = await supabase
          .from("memos")
          .select("source_url")
          .eq("user_id", user.id);

        const existingMemoUrls = new Set(
          existingMemos?.map((m) => m.source_url) || []
        );

        let stored = 0;
        for (const { query, result } of discoveries) {
          const url = result.url || result.hnUrl;

          // Skip if already captured or already a memo
          if (existingUrls.has(url) || existingMemoUrls.has(url)) continue;

          // Calculate relevance based on which interest matched
          const matchedInterest = interests.find((i) => i.value === query);
          const relevanceScore = matchedInterest?.weight || 0.5;

          // Store as memo
          const { error } = await supabase.from("memos").upsert(
            {
              user_id: user.id,
              source_url: url,
              source_platform: "hackernews",
              external_id: result.id,
              title: result.title,
              summary: `${result.points} points, ${result.comments} comments on HN`,
              relevance_score: relevanceScore,
              relevance_reason: `Matches your interest in "${query}"`,
              matched_interests: [
                {
                  type: "topic",
                  value: query,
                  weight: matchedInterest?.weight,
                },
              ],
              status: "pending",
            },
            { onConflict: "user_id,source_url", ignoreDuplicates: true }
          );

          if (!error) stored++;
        }

        logger.info({ stored, userId: user.id }, 'Stored new memos');
        return stored;
      });

      totalMemos += storedCount;
    }

    return { processed: users.length, memosCreated: totalMemos };
  }
);
