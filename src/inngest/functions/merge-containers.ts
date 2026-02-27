// Weekly container merge cron — detects and auto-merges overlapping containers

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase";
import { suggestMerges, executeMerge } from "@/lib/containers";
import logger from "@/lib/logger";

export const mergeContainers = inngest.createFunction(
  {
    id: "merge-containers",
    retries: 1,
  },
  { cron: "0 3 * * 0" }, // Every Sunday at 3am UTC
  async ({ step }) => {
    const supabase = createServiceClient();

    // Step 1: Get all users who have containers
    const users = await step.run("get-users-with-containers", async () => {
      const { data } = await supabase
        .from("containers")
        .select("user_id")
        .order("user_id");

      // Deduplicate user IDs
      const uniqueUserIds = [...new Set(data?.map((c) => c.user_id) || [])];
      return uniqueUserIds;
    });

    let totalMerges = 0;

    for (const userId of users) {
      // Step 2: Fetch containers with sample item titles for context
      const candidates = await step.run(
        `fetch-containers-${userId}`,
        async () => {
          const { data: containers } = await supabase
            .from("containers")
            .select("id, name, description, item_count")
            .eq("user_id", userId)
            .order("item_count", { ascending: false });

          if (!containers || containers.length < 2) return null;

          // Fetch sample item titles for each container (max 5 per container)
          const candidates = [];
          for (const container of containers) {
            const { data: items } = await supabase
              .from("container_items")
              .select("item_id")
              .eq("container_id", container.id)
              .limit(5);

            let itemTitles: string[] = [];
            if (items && items.length > 0) {
              const { data: itemData } = await supabase
                .from("items")
                .select("title")
                .in(
                  "id",
                  items.map((i) => i.item_id)
                );

              itemTitles =
                (itemData
                  ?.map((i) => i.title)
                  .filter(Boolean) as string[]) || [];
            }

            candidates.push({
              id: container.id,
              name: container.name,
              description: container.description,
              item_count: container.item_count,
              items: itemTitles,
            });
          }

          return candidates;
        }
      );

      if (!candidates) continue;

      // Step 3: Get merge suggestions from LLM
      const suggestions = await step.run(
        `suggest-merges-${userId}`,
        async () => {
          return await suggestMerges(candidates);
        }
      );

      if (!suggestions || suggestions.merges.length === 0) continue;

      // Step 4: Execute each merge
      for (const merge of suggestions.merges) {
        const result = await step.run(
          `execute-merge-${userId}-${merge.source}`,
          async () => {
            return await executeMerge(supabase, merge);
          }
        );

        if (result.success) {
          totalMerges++;
          logger.info(
            { userId, reason: merge.reason, itemsMoved: result.itemsMoved },
            'Merged containers'
          );
        }
      }
    }

    return { usersProcessed: users.length, mergesExecuted: totalMerges };
  }
);
