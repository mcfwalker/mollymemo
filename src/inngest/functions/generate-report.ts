// MOL-17: Daily trend report generation — runs T-Su at 6am UTC
// MOL-18: Weekly roundup generation — runs Monday at 6am UTC
// MOL-19: Integrates Sidespace project data via project_anchors + item_project_relevance
// Calls Claude Opus to generate written trend analysis. Stores in reports table.

import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../client";
import { createServiceClient } from "@/lib/supabase";
import { sendReportEmail } from "@/lib/email";
import logger from "@/lib/logger";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Claude Opus 4 pricing per million tokens
const OPUS_INPUT_COST = 15 / 1_000_000;
const OPUS_OUTPUT_COST = 75 / 1_000_000;

function calculateCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * OPUS_INPUT_COST + outputTokens * OPUS_OUTPUT_COST;
}

export const generateDailyReport = inngest.createFunction(
  {
    id: "generate-daily-report",
    retries: 1,
  },
  // Tuesday–Sunday at 6am UTC (Monday is weekly roundup — MOL-18)
  { cron: "0 6 * * 0,2-6" },
  async ({ step }) => {
    const supabase = createServiceClient();

    // Step 1: Get users who want reports
    const users = await step.run("get-eligible-users", async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, email, display_name, timezone, molly_context, report_frequency")
        .neq("report_frequency", "none");

      if (error) throw new Error(`Failed to fetch users: ${error.message}`);
      return data || [];
    });

    if (users.length === 0) {
      return { usersProcessed: 0, reportsGenerated: 0 };
    }

    let reportsGenerated = 0;
    let totalCost = 0;

    for (const user of users) {
      // Step 2: Fetch items from last 24h
      const items = await step.run(
        `fetch-items-${user.id}`,
        async () => {
          const windowStart = new Date(
            Date.now() - 24 * 60 * 60 * 1000
          ).toISOString();

          const { data, error } = await supabase
            .from("items")
            .select(
              "id, title, summary, domain, content_type, tags, source_url, source_type"
            )
            .eq("user_id", user.id)
            .eq("status", "processed")
            .gte("captured_at", windowStart)
            .order("captured_at", { ascending: false });

          if (error) {
            logger.error({ err: error, userId: user.id }, 'Failed to fetch items');
            return [];
          }
          return data || [];
        }
      );

      // Skip if no items captured in window
      if (items.length === 0) {
        logger.info({ userId: user.id }, 'No items in 24h window, skipping');
        continue;
      }

      // Step 3: Fetch project anchors, trends, previous report, and item-project links
      const context = await step.run(
        `fetch-context-${user.id}`,
        async () => {
          const itemIds = items.map((i) => i.id);

          const [projectsResult, trendsResult, prevReportResult, relevanceResult] =
            await Promise.all([
              supabase
                .from("project_anchors")
                .select("name, description, tags, stage")
                .eq("user_id", user.id),
              supabase
                .from("trends")
                .select("trend_type, title, description, strength")
                .eq("user_id", user.id)
                .gte(
                  "expires_at",
                  new Date().toISOString()
                ),
              supabase
                .from("reports")
                .select("title, content, generated_at, item_count")
                .eq("user_id", user.id)
                .eq("report_type", "daily")
                .order("generated_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
              // MOL-19: item-project relevance tags for captured items
              supabase.rpc("get_item_project_tags", { p_item_ids: itemIds }),
            ]);

          // Build item→project map for prompt enrichment
          const itemProjectMap: Record<string, string[]> = {};
          if (relevanceResult.data) {
            for (const row of relevanceResult.data) {
              if (!itemProjectMap[row.item_id]) {
                itemProjectMap[row.item_id] = [];
              }
              itemProjectMap[row.item_id].push(row.project_name);
            }
          }

          return {
            projects: projectsResult.data || [],
            trends: trendsResult.data || [],
            previousReport: prevReportResult.data,
            itemProjectMap,
          };
        }
      );

      // Step 4: Generate report via Claude Opus
      const report = await step.run(
        `generate-report-${user.id}`,
        async () => {
          const windowEnd = new Date();
          const windowStart = new Date(
            windowEnd.getTime() - 24 * 60 * 60 * 1000
          );

          const prompt = buildDailyPrompt({
            userName: user.display_name || "there",
            userContext: user.molly_context,
            items,
            projects: context.projects,
            trends: context.trends,
            previousReport: context.previousReport,
            itemProjectMap: context.itemProjectMap,
          });

          const message = await anthropic.messages.create({
            model: "claude-opus-4-20250514",
            max_tokens: 4000,
            messages: [{ role: "user", content: prompt }],
          });

          const cost = calculateCost(
            message.usage.input_tokens,
            message.usage.output_tokens
          );

          const textBlock = message.content.find(
            (block) => block.type === "text"
          );
          if (!textBlock || textBlock.type !== "text") {
            throw new Error("No text response from Claude");
          }

          // Parse structured response
          const parsed = parseReportResponse(textBlock.text);

          return {
            title: parsed.title,
            content: parsed.content,
            projectsMentioned: parsed.projectsMentioned,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            cost,
          };
        }
      );

      // Step 5: Store report
      const reportId = await step.run(`store-report-${user.id}`, async () => {
        const { data: inserted, error } = await supabase
          .from("reports")
          .insert({
            user_id: user.id,
            report_type: "daily",
            title: report.title,
            content: report.content,
            window_start: report.windowStart,
            window_end: report.windowEnd,
            item_count: items.length,
            projects_mentioned: report.projectsMentioned,
          })
          .select("id")
          .single();

        if (error) {
          throw new Error(`Failed to store report: ${error.message}`);
        }

        logger.info(
          { userId: user.id, title: report.title, itemCount: items.length, cost: report.cost },
          'Daily report stored'
        );
        return inserted.id;
      });

      // Step 6: Send email
      if (user.email && process.env.RESEND_API_KEY) {
        await step.run(`email-report-${user.id}`, async () => {
          await sendReportEmail({
            to: user.email,
            reportType: "daily",
            title: report.title,
            content: report.content,
            windowStart: report.windowStart,
            windowEnd: report.windowEnd,
            itemCount: items.length,
            projectsMentioned: report.projectsMentioned,
          });

          await supabase
            .from("reports")
            .update({ emailed_at: new Date().toISOString() })
            .eq("id", reportId);

          logger.info({ email: user.email }, 'Daily report emailed');
        });
      }

      reportsGenerated++;
      totalCost += report.cost;
    }

    return {
      usersProcessed: users.length,
      reportsGenerated,
      totalCost: `$${totalCost.toFixed(4)}`,
    };
  }
);

// --- Prompt building ---

interface PromptInput {
  userName: string;
  userContext: string | null;
  items: Array<{
    id?: string;
    title: string | null;
    summary: string | null;
    domain: string | null;
    content_type: string | null;
    tags: string[] | null;
    source_url: string;
    source_type: string;
  }>;
  projects: Array<{
    name: string;
    description: string | null;
    tags: string[];
    stage: string | null;
  }>;
  trends: Array<{
    trend_type: string;
    title: string;
    description: string;
    strength: number;
  }>;
  previousReport: {
    title: string;
    content: string;
    generated_at: string;
    item_count: number;
  } | null;
  itemProjectMap?: Record<string, string[]>;
}

function buildDailyPrompt(input: PromptInput): string {
  const { userName, userContext, items, projects, trends, previousReport, itemProjectMap } =
    input;

  const itemsBlock = items
    .map(
      (item, i) => {
        const linkedProjects = item.id ? itemProjectMap?.[item.id] : undefined;
        const projectLine = linkedProjects?.length
          ? `\n   Linked projects: ${linkedProjects.join(", ")}`
          : "";
        return `${i + 1}. **${item.title || "Untitled"}** (${item.source_type}, ${item.domain || "general"})
   ${item.summary || "No summary"}
   Tags: ${item.tags?.join(", ") || "none"}${projectLine}`;
      }
    )
    .join("\n\n");

  const projectsBlock =
    projects.length > 0
      ? projects
          .map(
            (p) =>
              `- **${p.name}** (${p.stage || "active"}): ${p.description || "no description"} [tags: ${p.tags?.join(", ") || "none"}]`
          )
          .join("\n")
      : "No active projects.";

  const trendsBlock =
    trends.length > 0
      ? trends
          .map(
            (t) =>
              `- [${t.trend_type}, strength ${t.strength}] ${t.title}: ${t.description}`
          )
          .join("\n")
      : "No active trends detected.";

  let previousBlock =
    "No previous report — this is the first one. Start fresh.";
  if (previousReport) {
    const daysAgo = Math.floor(
      (Date.now() - new Date(previousReport.generated_at).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    const timeRef = daysAgo <= 1 ? "yesterday" : `${daysAgo} days ago`;
    previousBlock = `Previous report (${timeRef}, ${previousReport.item_count} items): "${previousReport.title}"
---
${previousReport.content.slice(0, 2000)}${previousReport.content.length > 2000 ? "..." : ""}
---
Reference this naturally if there's a thematic connection. Don't force it.`;
  }

  return `You are writing a daily trend report for ${userName}'s personal knowledge base.

## Your Task
Analyze the items captured in the last 24 hours. Identify patterns, connect them to active projects, and provide proactive suggestions. Write for someone who saves lots of links and wants to know what patterns are emerging.

## Report Structure
Your report should be 400-800 words of rich, insightful markdown.

1. **Opening insight** — Lead with the most interesting pattern or connection, not a summary of what was saved
2. **Pattern analysis** — What themes emerge? What's gaining momentum? Are any items surprisingly connected?
3. **Project connections** — How do these items relate to active projects? Be specific about which items connect to which projects and why
4. **Trajectory & suggestions** — Based on what's being captured, what areas are worth exploring further? What's the trajectory suggesting?
5. **Item highlights** — Reference specific items as evidence throughout (not as a list at the end)

## Formatting
- Write in second person ("you", "your")
- Use markdown headers (##), bold, and bullet points
- Reference specific items by name as evidence for your analysis
- Be insightful and specific, not generic

## Output Format
Return your response in this exact format:

TITLE: [A specific, evocative title that captures the day's theme — NOT generic like "Daily Report"]

PROJECTS_MENTIONED: [Comma-separated project names that you referenced, or "none"]

CONTENT:
[Your full report in markdown]

## Context About ${userName}
${userContext || "New user — no context yet."}

## Previous Report
${previousBlock}

## Active Projects
${projectsBlock}

## Active Trends
${trendsBlock}

## Items Captured (last 24h): ${items.length} items

${itemsBlock}`;
}

// --- Response parsing ---

interface ParsedReport {
  title: string;
  content: string;
  projectsMentioned: { name: string }[] | null;
}

function parseReportResponse(text: string): ParsedReport {
  const titleMatch = text.match(/^TITLE:\s*(.+)$/m);
  const projectsMatch = text.match(/^PROJECTS_MENTIONED:\s*(.+)$/m);
  const contentMatch = text.match(/^CONTENT:\s*\n([\s\S]+)$/m);

  const title = titleMatch?.[1]?.trim() || "Daily Trend Report";
  const content = contentMatch?.[1]?.trim() || text;

  let projectsMentioned: { name: string }[] | null = null;
  if (projectsMatch) {
    const raw = projectsMatch[1].trim();
    if (raw.toLowerCase() !== "none") {
      projectsMentioned = raw.split(",").map((name) => ({
        name: name.trim(),
      }));
    }
  }

  return { title, content, projectsMentioned };
}

// ============================================================
// MOL-18: Weekly roundup — synthesizes daily reports into a
// higher-level narrative. Runs Monday at 6am UTC.
// ============================================================

export const generateWeeklyReport = inngest.createFunction(
  {
    id: "generate-weekly-report",
    retries: 1,
  },
  { cron: "0 6 * * 1" }, // Monday at 6am UTC
  async ({ step }) => {
    const supabase = createServiceClient();

    const users = await step.run("get-eligible-users", async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, email, display_name, timezone, molly_context, report_frequency")
        .neq("report_frequency", "none");

      if (error) throw new Error(`Failed to fetch users: ${error.message}`);
      return data || [];
    });

    if (users.length === 0) {
      return { usersProcessed: 0, reportsGenerated: 0 };
    }

    let reportsGenerated = 0;
    let totalCost = 0;

    for (const user of users) {
      // Fetch this week's daily reports
      const weekData = await step.run(
        `fetch-week-${user.id}`,
        async () => {
          const weekStart = new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000
          ).toISOString();

          const [dailiesResult, projectsResult, trendsResult, prevWeeklyResult] =
            await Promise.all([
              supabase
                .from("reports")
                .select("title, content, generated_at, item_count, projects_mentioned")
                .eq("user_id", user.id)
                .eq("report_type", "daily")
                .gte("generated_at", weekStart)
                .order("generated_at", { ascending: true }),
              supabase
                .from("project_anchors")
                .select("name, description, tags, stage")
                .eq("user_id", user.id),
              supabase
                .from("trends")
                .select("trend_type, title, description, strength")
                .eq("user_id", user.id)
                .gte("expires_at", new Date().toISOString()),
              supabase
                .from("reports")
                .select("title, content, generated_at, item_count")
                .eq("user_id", user.id)
                .eq("report_type", "weekly")
                .order("generated_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
            ]);

          return {
            dailies: dailiesResult.data || [],
            projects: projectsResult.data || [],
            trends: trendsResult.data || [],
            previousWeekly: prevWeeklyResult.data,
          };
        }
      );

      // Skip if no daily reports this week
      if (weekData.dailies.length === 0) {
        logger.info({ userId: user.id }, 'No daily reports this week, skipping');
        continue;
      }

      const report = await step.run(
        `generate-weekly-${user.id}`,
        async () => {
          const windowEnd = new Date();
          const windowStart = new Date(
            windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000
          );

          const prompt = buildWeeklyPrompt({
            userName: user.display_name || "there",
            userContext: user.molly_context,
            dailies: weekData.dailies,
            projects: weekData.projects,
            trends: weekData.trends,
            previousWeekly: weekData.previousWeekly,
          });

          const message = await anthropic.messages.create({
            model: "claude-opus-4-20250514",
            max_tokens: 6000,
            messages: [{ role: "user", content: prompt }],
          });

          const cost = calculateCost(
            message.usage.input_tokens,
            message.usage.output_tokens
          );

          const textBlock = message.content.find(
            (block) => block.type === "text"
          );
          if (!textBlock || textBlock.type !== "text") {
            throw new Error("No text response from Claude");
          }

          const parsed = parseReportResponse(textBlock.text);

          return {
            title: parsed.title,
            content: parsed.content,
            projectsMentioned: parsed.projectsMentioned,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            itemCount: weekData.dailies.reduce(
              (sum, d) => sum + (d.item_count || 0),
              0
            ),
            cost,
          };
        }
      );

      const weeklyReportId = await step.run(`store-weekly-${user.id}`, async () => {
        const { data: inserted, error } = await supabase
          .from("reports")
          .insert({
            user_id: user.id,
            report_type: "weekly",
            title: report.title,
            content: report.content,
            window_start: report.windowStart,
            window_end: report.windowEnd,
            item_count: report.itemCount,
            projects_mentioned: report.projectsMentioned,
          })
          .select("id")
          .single();

        if (error) {
          throw new Error(`Failed to store weekly report: ${error.message}`);
        }

        logger.info(
          { userId: user.id, title: report.title, dailiesCount: weekData.dailies.length, cost: report.cost },
          'Weekly report stored'
        );
        return inserted.id;
      });

      // Send weekly email
      if (user.email && process.env.RESEND_API_KEY) {
        await step.run(`email-weekly-${user.id}`, async () => {
          await sendReportEmail({
            to: user.email,
            reportType: "weekly",
            title: report.title,
            content: report.content,
            windowStart: report.windowStart,
            windowEnd: report.windowEnd,
            itemCount: report.itemCount,
            projectsMentioned: report.projectsMentioned,
          });

          await supabase
            .from("reports")
            .update({ emailed_at: new Date().toISOString() })
            .eq("id", weeklyReportId);

          logger.info({ email: user.email }, 'Weekly report emailed');
        });
      }

      reportsGenerated++;
      totalCost += report.cost;
    }

    return {
      usersProcessed: users.length,
      reportsGenerated,
      totalCost: `$${totalCost.toFixed(4)}`,
    };
  }
);

// --- Weekly prompt ---

interface WeeklyPromptInput {
  userName: string;
  userContext: string | null;
  dailies: Array<{
    title: string;
    content: string;
    generated_at: string;
    item_count: number;
    projects_mentioned: { name: string }[] | null;
  }>;
  projects: Array<{
    name: string;
    description: string | null;
    tags: string[];
    stage: string | null;
  }>;
  trends: Array<{
    trend_type: string;
    title: string;
    description: string;
    strength: number;
  }>;
  previousWeekly: {
    title: string;
    content: string;
    generated_at: string;
    item_count: number;
  } | null;
}

function buildWeeklyPrompt(input: WeeklyPromptInput): string {
  const { userName, userContext, dailies, projects, trends, previousWeekly } =
    input;

  const totalItems = dailies.reduce((sum, d) => sum + (d.item_count || 0), 0);

  const dailiesBlock = dailies
    .map((d, i) => {
      const date = new Date(d.generated_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      return `### ${date} — "${d.title}" (${d.item_count} items)
${d.content.slice(0, 1500)}${d.content.length > 1500 ? "\n..." : ""}`;
    })
    .join("\n\n");

  const projectsBlock =
    projects.length > 0
      ? projects
          .map(
            (p) =>
              `- **${p.name}** (${p.stage || "active"}): ${p.description || "no description"}`
          )
          .join("\n")
      : "No active projects.";

  const trendsBlock =
    trends.length > 0
      ? trends
          .map(
            (t) =>
              `- [${t.trend_type}, strength ${t.strength}] ${t.title}: ${t.description}`
          )
          .join("\n")
      : "No active trends.";

  let previousBlock = "No previous weekly report — this is the first one.";
  if (previousWeekly) {
    const weeksAgo = Math.floor(
      (Date.now() - new Date(previousWeekly.generated_at).getTime()) /
        (1000 * 60 * 60 * 24 * 7)
    );
    const timeRef = weeksAgo <= 1 ? "last week" : `${weeksAgo} weeks ago`;
    previousBlock = `Previous weekly report (${timeRef}, ${previousWeekly.item_count} items): "${previousWeekly.title}"
---
${previousWeekly.content.slice(0, 2000)}${previousWeekly.content.length > 2000 ? "..." : ""}
---
Reference this for week-over-week comparison if relevant.`;
  }

  return `You are writing a weekly roundup for ${userName}'s personal knowledge base.

## Your Task
Synthesize this week's ${dailies.length} daily reports into a higher-level narrative. Don't re-analyze individual items — work from the daily reports as your source material. Identify the week's arc: what themes emerged, strengthened, or faded? What cross-project connections appeared?

## Report Structure
Your report should be 600-1200 words of rich, insightful markdown.

1. **Week's arc** — The overarching narrative of this week's knowledge capture. What was the dominant thread?
2. **Pattern evolution** — Which patterns from individual days connected across the week? What gained momentum vs faded?
3. **Project impact** — How did this week's captures advance (or shift) active projects? Be specific.
4. **Cross-pollination** — Unexpected connections between different days' themes
5. **Trajectory** — Based on the week's arc, what directions are emerging for next week?
6. **Week by numbers** — Brief quantitative summary (items captured, projects touched, key themes)

## Formatting
- Write in second person
- Use markdown headers (##), bold, and bullet points
- Reference specific daily reports by their titles
- Be insightful and synthesizing, not repetitive

## Output Format
Return your response in this exact format:

TITLE: [A specific title capturing the week's dominant theme — NOT "Weekly Roundup"]

PROJECTS_MENTIONED: [Comma-separated project names, or "none"]

CONTENT:
[Your full report in markdown]

## Context About ${userName}
${userContext || "New user — no context yet."}

## Previous Weekly Report
${previousBlock}

## Active Projects
${projectsBlock}

## Active Trends
${trendsBlock}

## This Week's Daily Reports (${dailies.length} reports, ${totalItems} total items)

${dailiesBlock}`;
}
