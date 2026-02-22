// Daily trend detection cron — runs at 4am UTC (after 3am merge sweep)

import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase";
import {
  detectVelocity,
  detectEmergence,
  detectConvergence,
  narrateTrends,
  TrendSignal,
} from "@/lib/trends";

export const detectTrends = inngest.createFunction(
  {
    id: "detect-trends",
    retries: 1,
  },
  { cron: "0 4 * * *" },
  async ({ step }) => {
    const supabase = createServiceClient();

    const users = await step.run("get-users", async () => {
      const { data } = await supabase
        .from("user_interests")
        .select("user_id")
        .order("user_id");

      const uniqueUserIds = [...new Set(data?.map((i) => i.user_id) || [])];
      return uniqueUserIds;
    });

    let totalTrends = 0;

    for (const userId of users) {
      const signals = await step.run(
        `detect-signals-${userId}`,
        async () => {
          const [velocity, emergence, convergence] = await Promise.all([
            detectVelocity(supabase, userId),
            detectEmergence(supabase, userId),
            detectConvergence(supabase, userId),
          ]);

          return [
            ...velocity,
            ...emergence,
            ...convergence,
          ] as TrendSignal[];
        }
      );

      if (signals.length === 0) continue;

      const narrated = await step.run(
        `narrate-trends-${userId}`,
        async () => {
          return await narrateTrends(signals);
        }
      );

      if (!narrated || narrated.trends.length === 0) continue;

      await step.run(`store-trends-${userId}`, async () => {
        const expiresAt = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString();

        for (const trend of narrated.trends) {
          await supabase.from("trends").upsert(
            {
              user_id: userId,
              trend_type: trend.trendType,
              title: trend.title,
              description: trend.description,
              signals: trend.signals,
              strength: trend.strength,
              detected_at: new Date().toISOString(),
              expires_at: expiresAt,
              surfaced: false,
            },
            { onConflict: "user_id,trend_type,title" }
          );
        }

        totalTrends += narrated.trends.length;
        console.log(
          `Stored ${narrated.trends.length} trends for user ${userId}, narration cost: $${narrated.cost.toFixed(6)}`
        );
      });
    }

    await step.run("cleanup-expired", async () => {
      const { error } = await supabase
        .from("trends")
        .delete()
        .lt("expires_at", new Date().toISOString());

      if (error) {
        console.error("Failed to clean up expired trends:", error);
      }
    });

    return { usersProcessed: users.length, trendsStored: totalTrends };
  }
);
