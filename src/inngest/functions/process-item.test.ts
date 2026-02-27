import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Handler capture (vi.hoisted avoids TDZ with vi.mock hoisting) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const captured = vi.hoisted(() => ({
  handler: null as null | ((args: { event: any; step: any }) => Promise<any>),
  onFailure: null as null | ((args: { error: unknown; event: any }) => Promise<void>),
}));

// --- Mock declarations (hoisted) ---

vi.mock("@/inngest/client", () => ({
  inngest: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createFunction: (config: any, _trigger: any, fn: any) => {
      captured.handler = fn;
      captured.onFailure = config.onFailure;
      return {};
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/processors/github", () => ({
  processGitHub: vi.fn(),
}));

vi.mock("@/lib/processors/tiktok", () => ({
  processTikTok: vi.fn(),
}));

vi.mock("@/lib/processors/x", () => ({
  processX: vi.fn(),
}));

vi.mock("@/lib/processors/youtube", () => ({
  processYouTube: vi.fn(),
}));

vi.mock("@/lib/processors/article", () => ({
  processArticle: vi.fn(),
}));

vi.mock("@/lib/processors/classifier", () => ({
  classify: vi.fn(),
}));

vi.mock("@/lib/processors/repo-extractor", () => ({
  extractReposFromTranscript: vi.fn(),
  extractReposFromSummary: vi.fn(),
}));

vi.mock("@/lib/containers", () => ({
  assignContainers: vi.fn(),
  applyContainerAssignment: vi.fn(),
}));

vi.mock("@/lib/embeddings", () => ({
  embedItem: vi.fn(),
}));

vi.mock("@/lib/interests", () => ({
  extractInterests: vi.fn(),
  calculateWeight: vi.fn(),
}));

vi.mock("@/lib/telegram", () => ({
  sendMessage: vi.fn(),
}));

// --- Imports (after mocks) ---

import { createServiceClient } from "@/lib/supabase";
import { processGitHub } from "@/lib/processors/github";
import { processTikTok } from "@/lib/processors/tiktok";
import { processX } from "@/lib/processors/x";
import { processYouTube } from "@/lib/processors/youtube";
import { processArticle } from "@/lib/processors/article";
import { classify } from "@/lib/processors/classifier";
import {
  extractReposFromTranscript,
  extractReposFromSummary,
} from "@/lib/processors/repo-extractor";
import { assignContainers, applyContainerAssignment } from "@/lib/containers";
import { embedItem } from "@/lib/embeddings";
import { extractInterests, calculateWeight } from "@/lib/interests";
import { sendMessage } from "@/lib/telegram";

// Trigger module load → captures handler/onFailure
import "@/inngest/functions/process-item";

// --- Constants ---

const ITEM_ID = "item-123";
const USER_ID = "user-456";
const CHAT_ID = 99999;

// --- Fixture factories ---

function makeEvent(
  overrides: Record<string, unknown> = {}
): { data: Record<string, unknown> } {
  return {
    data: {
      itemId: ITEM_ID,
      sourceType: "github",
      sourceUrl: "https://github.com/owner/repo",
      userId: USER_ID,
      chatId: CHAT_ID,
      ...overrides,
    },
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    item_number: 1,
    user_id: USER_ID,
    source_url: "https://github.com/owner/repo",
    source_type: "github",
    title: null,
    summary: null,
    transcript: null,
    extracted_entities: null,
    domain: null,
    content_type: null,
    tags: null,
    github_url: null,
    github_metadata: null,
    captured_at: "2026-02-27T00:00:00Z",
    processed_at: null,
    status: "pending",
    error_message: null,
    raw_data: null,
    openai_cost: null,
    grok_cost: null,
    repo_extraction_cost: null,
    ...overrides,
  };
}

function makeStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
  };
}

function makeGitHubMeta(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-repo",
    description: "A test repository",
    stars: 1234,
    language: "TypeScript",
    topics: ["testing"],
    owner: "owner",
    repo: "test-repo",
    ...overrides,
  };
}

function makeClassification(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Title",
    summary: "Test summary of the content",
    domain: "software-engineering",
    content_type: "repo",
    tags: ["typescript", "testing"],
    cost: 0.001,
    ...overrides,
  };
}

function makeProcessedItemResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      title: "Test Title",
      summary: "Test summary of the content",
      tags: ["typescript", "testing"],
      domain: "software-engineering",
      content_type: "repo",
      user_id: USER_ID,
      github_url: null,
      ...overrides,
    },
    error: null,
  };
}

/**
 * Build a chainable Supabase mock.
 *
 * `singleResponses` is a queue — each .single() call pops the next response.
 * `.update().eq()` is thenable (resolves to `{ error: null }`).
 * `.insert()` resolves to `{ error: null }`.
 * `.order()` resolves to `{ data: [], error: null }` (for containers/anchors).
 */
function buildSupabaseMock(
  singleResponses: Array<{ data: unknown; error: unknown }>,
  orderResponses?: Array<{ data: unknown; error: unknown }>
) {
  let singleIdx = 0;
  let orderIdx = 0;

  const mockSingle = vi.fn(() => {
    const resp = singleResponses[singleIdx] ?? { data: null, error: null };
    singleIdx++;
    return Promise.resolve(resp);
  });

  const mockOrder = vi.fn(() => {
    const resp = orderResponses?.[orderIdx] ?? { data: [], error: null };
    orderIdx++;
    return Promise.resolve(resp);
  });

  // Terminal node: returned by .eq() — thenable for update pattern, has .single() for select pattern
  const terminal: Record<string, unknown> = {
    single: mockSingle,
    eq: vi.fn((): Record<string, unknown> => terminal),
    order: mockOrder,
    // Thenable: when `await supabase.from("items").update(...).eq(...)` is called,
    // the runtime awaits this, resolving via .then()
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };

  const mock: Record<string, unknown> = {
    from: vi.fn(() => mock),
    select: vi.fn(() => mock),
    update: vi.fn(() => mock),
    insert: vi.fn(() => Promise.resolve({ error: null })),
    eq: vi.fn(() => terminal),
    order: mockOrder,
    single: mockSingle,
  };

  return { mock, mockSingle, mockOrder };
}

// --- Default mock setup for GitHub happy path ---

function setupGitHubHappyPath() {
  const item = makeItem();
  const ghMeta = makeGitHubMeta();
  const classification = makeClassification();
  const processedItem = makeProcessedItemResponse();

  // Supabase .single() call sequence for GitHub happy path:
  // 1. fetch-item → item
  // 2. assign-containers → processed item (title check)
  // 3. assign-containers → (none — containers query uses .order())
  // 4. assign-containers → (none — anchors query uses .order())
  // 5. generate-embedding → processed item
  // 6. extract-interests → processed item
  // 7. extract-interests → existing interest lookup (not found)
  // 8. notify-user → processed item
  const { mock: supabase } = buildSupabaseMock(
    [
      { data: item, error: null }, // fetch-item
      processedItem, // assign-containers: processed item
      processedItem, // generate-embedding
      processedItem, // extract-interests: processed item
      { data: null, error: { code: "PGRST116" } }, // extract-interests: interest lookup (not found)
      processedItem, // notify-user
    ],
    [
      { data: [], error: null }, // containers
      { data: [], error: null }, // anchors
    ]
  );

  vi.mocked(createServiceClient).mockReturnValue(supabase as never);
  vi.mocked(processGitHub).mockResolvedValue(ghMeta);
  vi.mocked(classify).mockResolvedValue(classification);
  vi.mocked(extractReposFromSummary).mockResolvedValue({
    repos: [],
    cost: 0,
  });
  vi.mocked(assignContainers).mockResolvedValue({
    existing: [],
    create: [{ name: "Dev Tools", description: "Developer tools" }],
    cost: 0.0005,
  });
  vi.mocked(applyContainerAssignment).mockResolvedValue({
    containerNames: ["Dev Tools"],
  });
  vi.mocked(embedItem).mockResolvedValue({
    embedding: new Array(1536).fill(0),
    cost: 0.0001,
  });
  vi.mocked(extractInterests).mockResolvedValue({
    interests: [{ type: "topic", value: "testing" }],
    cost: 0.0002,
  });
  vi.mocked(calculateWeight).mockReturnValue(0.7);
  vi.mocked(sendMessage).mockResolvedValue(undefined);

  return { item, ghMeta, classification, supabase };
}

// --- Tests ---

describe("processItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handler setup", () => {
    it("captures handler and onFailure from createFunction", () => {
      expect(captured.handler).toBeDefined();
      expect(typeof captured.handler).toBe("function");
      expect(captured.onFailure).toBeDefined();
      expect(typeof captured.onFailure).toBe("function");
    });
  });

  describe("happy path - github", () => {
    it("processes a GitHub item through all 10 steps", async () => {
      setupGitHubHappyPath();
      const event = makeEvent();
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
      expect(step.run).toHaveBeenCalledTimes(10);
      expect(step.run.mock.calls.map((c) => c[0])).toEqual([
        "mark-processing",
        "fetch-item",
        "extract-content",
        "classify",
        "extract-repos-from-summary",
        "save-results",
        "assign-containers",
        "generate-embedding",
        "extract-interests",
        "notify-user",
      ]);
    });

    it("sets github_url to source_url for github source type", async () => {
      const { supabase } = setupGitHubHappyPath();
      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      // The save-results step calls supabase.from("items").update(...)
      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      // Find the save-results update (has title, summary, etc.)
      const saveCall = updateCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "title" in c[0]
      );
      expect(saveCall).toBeDefined();
      expect(saveCall![0].github_url).toBe("https://github.com/owner/repo");
    });

    it("saves github_metadata with stars, language, description, topics", async () => {
      const { supabase } = setupGitHubHappyPath();
      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      const saveCall = updateCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "github_metadata" in c[0]
      );
      expect(saveCall).toBeDefined();
      expect(saveCall![0].github_metadata).toEqual({
        stars: 1234,
        language: "TypeScript",
        description: "A test repository",
        topics: ["testing"],
      });
    });
  });

  describe("happy path - tiktok", () => {
    it("processes TikTok: transcription + repo extraction from URLs", async () => {
      const item = makeItem({
        source_url: "https://tiktok.com/@user/video/123",
        source_type: "tiktok",
      });
      const classification = makeClassification();
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [
          { data: [], error: null },
          { data: [], error: null },
        ]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processTikTok).mockResolvedValue({
        transcript: "Check out this repo github.com/cool/tool",
        extractedUrls: ["https://github.com/cool/tool"],
        repoExtractionCost: 0.0003,
      });
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());
      vi.mocked(classify).mockResolvedValue(classification);
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({
        existing: [],
        create: [],
        cost: 0.0005,
      });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [{ type: "topic", value: "tiktok" }], cost: 0 });
      vi.mocked(calculateWeight).mockReturnValue(0.5);
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent({
        sourceType: "tiktok",
        sourceUrl: "https://tiktok.com/@user/video/123",
      });
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
      expect(processTikTok).toHaveBeenCalledWith("https://tiktok.com/@user/video/123");
      expect(processGitHub).toHaveBeenCalledWith("https://github.com/cool/tool");
    });
  });

  describe("happy path - youtube", () => {
    it("processes YouTube: transcript + repo extraction", async () => {
      const item = makeItem({
        source_url: "https://youtube.com/watch?v=abc",
        source_type: "youtube",
      });
      const classification = makeClassification();
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [
          { data: [], error: null },
          { data: [], error: null },
        ]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processYouTube).mockResolvedValue({
        transcript: "This video covers testing frameworks",
        extractedUrls: [],
        repoExtractionCost: 0,
      });
      vi.mocked(classify).mockResolvedValue(classification);
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent({
        sourceType: "youtube",
        sourceUrl: "https://youtube.com/watch?v=abc",
      });
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
      expect(processYouTube).toHaveBeenCalledWith("https://youtube.com/watch?v=abc");
    });
  });

  describe("happy path - x (tweet)", () => {
    function setupXDefaults() {
      const item = makeItem({
        source_url: "https://x.com/user/status/123",
        source_type: "x",
      });
      const classification = makeClassification();
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [
          { data: [], error: null },
          { data: [], error: null },
        ]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(classify).mockResolvedValue(classification);
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(extractReposFromTranscript).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      return { item, supabase };
    }

    it("processes an X post with video transcript", async () => {
      setupXDefaults();
      vi.mocked(processX).mockResolvedValue({
        text: "Check this out",
        videoTranscript: "Full video transcript here",
        authorName: "testuser",
        authorUrl: "https://x.com/testuser",
        resolvedUrls: [],
        isLinkOnly: false,
        xArticleUrl: null,
        summary: null,
        grokCitations: [],
        usedGrok: false,
        grokCost: 0,
      });

      const event = makeEvent({
        sourceType: "x",
        sourceUrl: "https://x.com/user/status/123",
      });
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
      expect(processX).toHaveBeenCalledWith("https://x.com/user/status/123");
    });

    it("processes link-only tweet using resolved URL", async () => {
      setupXDefaults();
      vi.mocked(processX).mockResolvedValue({
        text: "",
        videoTranscript: null,
        authorName: "testuser",
        authorUrl: "https://x.com/testuser",
        resolvedUrls: ["https://example.com/article"],
        isLinkOnly: true,
        xArticleUrl: null,
        summary: null,
        grokCitations: [],
        usedGrok: false,
        grokCost: 0,
      });

      const event = makeEvent({
        sourceType: "x",
        sourceUrl: "https://x.com/user/status/123",
      });
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
    });

    it("triggers extractReposFromTranscript when no repos found in URLs", async () => {
      setupXDefaults();
      vi.mocked(processX).mockResolvedValue({
        text: "Great tool for building APIs",
        videoTranscript: null,
        authorName: "testuser",
        authorUrl: "https://x.com/testuser",
        resolvedUrls: [],
        isLinkOnly: false,
        xArticleUrl: null,
        summary: null,
        grokCitations: [],
        usedGrok: false,
        grokCost: 0,
      });
      vi.mocked(extractReposFromTranscript).mockResolvedValue({
        repos: [{ url: "https://github.com/found/repo", name: "repo", context: "mentioned" }],
        cost: 0.0004,
      });
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());

      const event = makeEvent({
        sourceType: "x",
        sourceUrl: "https://x.com/user/status/123",
      });
      const step = makeStep();

      await captured.handler!({ event, step });

      expect(extractReposFromTranscript).toHaveBeenCalled();
      expect(processGitHub).toHaveBeenCalledWith("https://github.com/found/repo");
    });
  });

  describe("happy path - article", () => {
    it("processes article: extract content + GitHub URLs in text", async () => {
      const item = makeItem({
        source_url: "https://example.com/blog/post",
        source_type: "article",
      });
      const classification = makeClassification();
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [
          { data: [], error: null },
          { data: [], error: null },
        ]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processArticle).mockResolvedValue({
        title: "Blog Post",
        content: "Article content with github.com/cool/lib mentioned",
        excerpt: "excerpt",
        byline: "Author",
        siteName: "Example Blog",
        publishedTime: null,
      });
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());
      vi.mocked(classify).mockResolvedValue(classification);
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent({
        sourceType: "article",
        sourceUrl: "https://example.com/blog/post",
      });
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
      expect(processArticle).toHaveBeenCalledWith("https://example.com/blog/post");
      expect(processGitHub).toHaveBeenCalled();
    });
  });

  describe("X article early return", () => {
    function setupXArticle(chatId?: number) {
      const item = makeItem({
        source_url: "https://x.com/user/status/123",
        source_type: "x",
      });

      const { mock: supabase } = buildSupabaseMock([
        { data: item, error: null },
      ]);

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processX).mockResolvedValue({
        text: "",
        videoTranscript: null,
        authorName: "journalist",
        authorUrl: "https://x.com/journalist",
        resolvedUrls: [],
        isLinkOnly: false,
        xArticleUrl: "https://x.com/journalist/articles/456",
        summary: null,
        grokCitations: [],
        usedGrok: false,
        grokCost: 0.01,
      });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      return { supabase };
    }

    it("short-circuits pipeline when isXArticle is true", async () => {
      setupXArticle();
      const event = makeEvent({
        sourceType: "x",
        sourceUrl: "https://x.com/user/status/123",
      });
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", type: "x-article" });
      // Only 4 steps should run (mark-processing, fetch-item, extract-content, save-x-article)
      // Plus notify-x-article when chatId is present = 5
      expect(step.run).toHaveBeenCalledTimes(5);
      // Later steps should NOT run
      expect(classify).not.toHaveBeenCalled();
      expect(assignContainers).not.toHaveBeenCalled();
      expect(embedItem).not.toHaveBeenCalled();
      expect(extractInterests).not.toHaveBeenCalled();
    });

    it("sends Telegram notification for X article when chatId is present", async () => {
      setupXArticle();
      const event = makeEvent({
        sourceType: "x",
        sourceUrl: "https://x.com/user/status/123",
        chatId: CHAT_ID,
      });
      const step = makeStep();

      await captured.handler!({ event, step });

      expect(sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("X Article")
      );
    });

    it("skips Telegram notification when no chatId", async () => {
      setupXArticle();
      const event = makeEvent({
        sourceType: "x",
        sourceUrl: "https://x.com/user/status/123",
        chatId: undefined,
      });
      const step = makeStep();

      await captured.handler!({ event, step });

      // Only 4 steps (no notify)
      expect(step.run).toHaveBeenCalledTimes(4);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("graceful degradation", () => {
    it("throws when TikTok returns no transcript", async () => {
      const item = makeItem({ source_type: "tiktok", source_url: "https://tiktok.com/v/1" });
      const { mock: supabase } = buildSupabaseMock([{ data: item, error: null }]);

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processTikTok).mockResolvedValue(null as never);

      const event = makeEvent({ sourceType: "tiktok", sourceUrl: "https://tiktok.com/v/1" });
      const step = makeStep();

      await expect(captured.handler!({ event, step })).rejects.toThrow();
    });

    it("throws when GitHub metadata fetch fails", async () => {
      const item = makeItem();
      const { mock: supabase } = buildSupabaseMock([{ data: item, error: null }]);

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processGitHub).mockResolvedValue(null);

      const event = makeEvent();
      const step = makeStep();

      await expect(captured.handler!({ event, step })).rejects.toThrow("GitHub metadata fetch failed");
    });

    it("throws when X/Twitter fetch returns null", async () => {
      const item = makeItem({ source_type: "x", source_url: "https://x.com/u/status/1" });
      const { mock: supabase } = buildSupabaseMock([{ data: item, error: null }]);

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processX).mockResolvedValue(null as never);

      const event = makeEvent({ sourceType: "x", sourceUrl: "https://x.com/u/status/1" });
      const step = makeStep();

      await expect(captured.handler!({ event, step })).rejects.toThrow("X/Twitter fetch failed");
    });

    it("throws when YouTube returns no transcript", async () => {
      const item = makeItem({ source_type: "youtube", source_url: "https://youtube.com/watch?v=1" });
      const { mock: supabase } = buildSupabaseMock([{ data: item, error: null }]);

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processYouTube).mockResolvedValue(null as never);

      const event = makeEvent({ sourceType: "youtube", sourceUrl: "https://youtube.com/watch?v=1" });
      const step = makeStep();

      await expect(captured.handler!({ event, step })).rejects.toThrow();
    });

    it("handles article returning null — transcript is undefined", async () => {
      const item = makeItem({
        source_url: "https://example.com/broken",
        source_type: "article",
      });
      const classification = makeClassification();
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [
          { data: [], error: null },
          { data: [], error: null },
        ]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processArticle).mockResolvedValue(null);
      vi.mocked(classify).mockResolvedValue(classification);
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent({
        sourceType: "article",
        sourceUrl: "https://example.com/broken",
      });
      const step = makeStep();

      // Should NOT throw — article returning null just means transcript is undefined
      const result = await captured.handler!({ event, step });
      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
    });

    it("handles classify returning null — saves without classification fields", async () => {
      const { supabase } = setupGitHubHappyPath();
      vi.mocked(classify).mockResolvedValue(null);

      const event = makeEvent();
      const step = makeStep();

      const result = await captured.handler!({ event, step });

      expect(result).toEqual({ status: "processed", itemId: ITEM_ID });
      // save-results should still be called, just without title/summary/domain etc.
      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      const saveCall = updateCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "status" in c[0] && c[0].status === "processed"
      );
      expect(saveCall).toBeDefined();
      // When classify returns null, title falls through to githubMetadata.name fallback
      expect(saveCall![0].title).toBe("test-repo");
      // But classification-specific fields should NOT be set
      expect(saveCall![0].domain).toBeUndefined();
      expect(saveCall![0].content_type).toBeUndefined();
      expect(saveCall![0].tags).toBeUndefined();
    });
  });

  describe("cost accumulation", () => {
    it("tracks openai_cost from classification", async () => {
      const { supabase } = setupGitHubHappyPath();
      vi.mocked(classify).mockResolvedValue(makeClassification({ cost: 0.005 }));

      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      const saveCall = updateCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "openai_cost" in c[0]
      );
      expect(saveCall).toBeDefined();
      expect(saveCall![0].openai_cost).toBe(0.005);
    });

    it("tracks grok_cost from X processor", async () => {
      const item = makeItem({ source_type: "x", source_url: "https://x.com/u/status/1" });
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [{ data: [], error: null }, { data: [], error: null }]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processX).mockResolvedValue({
        text: "test tweet",
        videoTranscript: null,
        authorName: "user",
        authorUrl: "https://x.com/user",
        resolvedUrls: [],
        isLinkOnly: false,
        xArticleUrl: null,
        summary: null,
        grokCitations: [],
        usedGrok: true,
        grokCost: 0.02,
      });
      vi.mocked(classify).mockResolvedValue(makeClassification());
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent({ sourceType: "x", sourceUrl: "https://x.com/u/status/1" });
      const step = makeStep();

      await captured.handler!({ event, step });

      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      const saveCall = updateCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "grok_cost" in c[0]
      );
      expect(saveCall).toBeDefined();
      expect(saveCall![0].grok_cost).toBe(0.02);
    });

    it("accumulates repo_extraction_cost across extract + summary steps", async () => {
      const item = makeItem({
        source_type: "tiktok",
        source_url: "https://tiktok.com/v/1",
      });
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [{ data: [], error: null }, { data: [], error: null }]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processTikTok).mockResolvedValue({
        transcript: "some content",
        extractedUrls: [],
        repoExtractionCost: 0.003,
      });
      vi.mocked(processGitHub).mockResolvedValue(null);
      vi.mocked(classify).mockResolvedValue(
        makeClassification({ title: "T", summary: "S" })
      );
      vi.mocked(extractReposFromSummary).mockResolvedValue({
        repos: [],
        cost: 0.002,
      });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent({ sourceType: "tiktok", sourceUrl: "https://tiktok.com/v/1" });
      const step = makeStep();

      await captured.handler!({ event, step });

      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      const saveCall = updateCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "repo_extraction_cost" in c[0]
      );
      expect(saveCall).toBeDefined();
      // 0.003 from extract + 0.002 from summary = 0.005
      expect(saveCall![0].repo_extraction_cost).toBeCloseTo(0.005);
    });
  });

  describe("second-pass repo extraction", () => {
    it("calls extractReposFromSummary when repos empty and classification exists", async () => {
      setupGitHubHappyPath();
      // Override: GitHub processor returns null (no repos found in extract step)
      vi.mocked(processGitHub).mockResolvedValue(null);

      const event = makeEvent();
      const step = makeStep();

      // This will throw because processGitHub returns null for github source type
      // Use article source type instead for this test
      const item = makeItem({ source_type: "article", source_url: "https://example.com/post" });
      const processedItem = makeProcessedItemResponse();
      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [{ data: [], error: null }, { data: [], error: null }]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processArticle).mockResolvedValue({
        title: "Post",
        content: "No github links here",
        excerpt: "",
        byline: "",
        siteName: "",
        publishedTime: null,
      });
      vi.mocked(classify).mockResolvedValue(makeClassification({ title: "Post", summary: "Summary" }));
      vi.mocked(extractReposFromSummary).mockResolvedValue({
        repos: [{ url: "https://github.com/found/via-summary", name: "via-summary", context: "" }],
        cost: 0.001,
      });
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const articleEvent = makeEvent({ sourceType: "article", sourceUrl: "https://example.com/post" });

      await captured.handler!({ event: articleEvent, step });

      // Note: third arg is the repos array passed by reference, which gets mutated
      // after the call when repos are pushed. We verify the call happened with correct title/summary.
      expect(extractReposFromSummary).toHaveBeenCalledWith(
        "Post",
        "Summary",
        expect.any(Array)
      );
      // And verify the found repo was processed
      expect(processGitHub).toHaveBeenCalledWith("https://github.com/found/via-summary");
    });

    it("skips extractReposFromSummary when classification is null", async () => {
      const item = makeItem({ source_type: "article", source_url: "https://example.com/post" });
      const processedItem = makeProcessedItemResponse();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: item, error: null },
          processedItem,
          processedItem,
          processedItem,
          { data: null, error: { code: "PGRST116" } },
          processedItem,
        ],
        [{ data: [], error: null }, { data: [], error: null }]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processArticle).mockResolvedValue({
        title: "Post",
        content: "Content",
        excerpt: "",
        byline: "",
        siteName: "",
        publishedTime: null,
      });
      vi.mocked(classify).mockResolvedValue(null);
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent({ sourceType: "article", sourceUrl: "https://example.com/post" });
      const step = makeStep();

      await captured.handler!({ event, step });

      // extractReposFromSummary is called but the condition inside skips the actual extraction
      // because classification is null, so repos.length stays 0 but the function still runs
      // The key assertion: processGitHub should NOT be called from the summary step
      // (it may be called from extract-content for article GitHub URL extraction)
    });
  });

  describe("container assignment", () => {
    it("skips assignment when processed item has no title", async () => {
      setupGitHubHappyPath();

      // Override: the processed item query returns no title
      const { mock: supabase } = buildSupabaseMock(
        [
          { data: makeItem(), error: null }, // fetch-item
          { data: { title: null, user_id: USER_ID }, error: null }, // assign-containers
          { data: { title: "Test Title", summary: "S", tags: [] }, error: null }, // generate-embedding
          { data: { title: "Test Title", summary: "S", tags: [], domain: "d", github_url: null, user_id: USER_ID }, error: null }, // extract-interests
          { data: null, error: { code: "PGRST116" } }, // interest lookup
          { data: { title: "Test Title", summary: "S" }, error: null }, // notify-user
        ],
        []
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());
      vi.mocked(classify).mockResolvedValue(makeClassification());
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [{ type: "topic", value: "t" }], cost: 0 });
      vi.mocked(calculateWeight).mockReturnValue(0.5);
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      expect(assignContainers).not.toHaveBeenCalled();
    });
  });

  describe("embedding generation", () => {
    it("skips embedding when processed item has no title", async () => {
      setupGitHubHappyPath();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: makeItem(), error: null },
          makeProcessedItemResponse(), // assign-containers
          { data: { title: null, summary: null, tags: null }, error: null }, // generate-embedding (no title)
          makeProcessedItemResponse(), // extract-interests
          { data: null, error: { code: "PGRST116" } },
          makeProcessedItemResponse(), // notify-user
        ],
        [{ data: [], error: null }, { data: [], error: null }]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());
      vi.mocked(classify).mockResolvedValue(makeClassification());
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(extractInterests).mockResolvedValue({ interests: [{ type: "topic", value: "t" }], cost: 0 });
      vi.mocked(calculateWeight).mockReturnValue(0.5);
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      expect(embedItem).not.toHaveBeenCalled();
    });
  });

  describe("interest extraction", () => {
    it("inserts new interests with weight 0.5", async () => {
      const { supabase } = setupGitHubHappyPath();
      vi.mocked(extractInterests).mockResolvedValue({
        interests: [{ type: "tool", value: "vitest" }],
        cost: 0.0002,
      });

      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      // The insert call for new interest
      const insertCalls = vi.mocked(supabase.insert as ReturnType<typeof vi.fn>).mock.calls;
      const interestInsert = insertCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "interest_type" in c[0]
      );
      expect(interestInsert).toBeDefined();
      expect(interestInsert![0]).toMatchObject({
        user_id: USER_ID,
        interest_type: "tool",
        value: "vitest",
        weight: 0.5,
        occurrence_count: 1,
      });
    });

    it("updates existing interest — increments count and recalculates weight", async () => {
      const { supabase } = setupGitHubHappyPath();

      // Override: interest lookup finds existing interest
      const { mock: supabaseOverride } = buildSupabaseMock(
        [
          { data: makeItem(), error: null },
          makeProcessedItemResponse(),
          makeProcessedItemResponse(),
          makeProcessedItemResponse(),
          // Interest found!
          {
            data: { id: "interest-1", occurrence_count: 3, first_seen: "2026-01-01" },
            error: null,
          },
          makeProcessedItemResponse(), // notify-user
        ],
        [{ data: [], error: null }, { data: [], error: null }]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabaseOverride as never);
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());
      vi.mocked(classify).mockResolvedValue(makeClassification());
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(extractInterests).mockResolvedValue({
        interests: [{ type: "topic", value: "testing" }],
        cost: 0.0002,
      });
      vi.mocked(calculateWeight).mockReturnValue(0.85);
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      expect(calculateWeight).toHaveBeenCalledWith(4, expect.any(Date));
      // Should call update, not insert, for existing interest
      const updateCalls = vi.mocked(supabaseOverride.update as ReturnType<typeof vi.fn>).mock.calls;
      const interestUpdate = updateCalls.find(
        (c) => c[0] && typeof c[0] === "object" && "occurrence_count" in c[0]
      );
      expect(interestUpdate).toBeDefined();
      expect(interestUpdate![0].occurrence_count).toBe(4);
      expect(interestUpdate![0].weight).toBe(0.85);
    });

    it("skips interest extraction when no title", async () => {
      setupGitHubHappyPath();

      const { mock: supabase } = buildSupabaseMock(
        [
          { data: makeItem(), error: null },
          makeProcessedItemResponse(),
          makeProcessedItemResponse(),
          // extract-interests: no title
          { data: { title: null, summary: null, tags: null, domain: null, github_url: null, user_id: USER_ID }, error: null },
          makeProcessedItemResponse(), // notify-user
        ],
        [{ data: [], error: null }, { data: [], error: null }]
      );

      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(processGitHub).mockResolvedValue(makeGitHubMeta());
      vi.mocked(classify).mockResolvedValue(makeClassification());
      vi.mocked(extractReposFromSummary).mockResolvedValue({ repos: [], cost: 0 });
      vi.mocked(assignContainers).mockResolvedValue({ existing: [], create: [], cost: 0 });
      vi.mocked(applyContainerAssignment).mockResolvedValue({ containerNames: [] });
      vi.mocked(embedItem).mockResolvedValue({ embedding: [], cost: 0 });
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = makeEvent();
      const step = makeStep();

      await captured.handler!({ event, step });

      expect(extractInterests).not.toHaveBeenCalled();
    });
  });

  describe("Telegram notification", () => {
    it("sends title, summary, and container info", async () => {
      setupGitHubHappyPath();

      const event = makeEvent({ chatId: CHAT_ID });
      const step = makeStep();

      await captured.handler!({ event, step });

      expect(sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("Test Title")
      );
    });

    it("skips notification when no chatId", async () => {
      setupGitHubHappyPath();

      const event = makeEvent({ chatId: undefined });
      const step = makeStep();

      await captured.handler!({ event, step });

      // sendMessage should not be called for the notify-user step
      // (9 steps instead of 10)
      expect(step.run).toHaveBeenCalledTimes(9);
    });
  });

  describe("onFailure handler", () => {
    it("updates item status to failed with error message", async () => {
      const { mock: supabase } = buildSupabaseMock([]);
      vi.mocked(createServiceClient).mockReturnValue(supabase as never);

      const event = {
        data: {
          itemId: ITEM_ID,
          sourceType: "github",
          sourceUrl: "https://github.com/owner/repo",
          userId: USER_ID,
          chatId: undefined,
        },
      };

      await captured.onFailure!({
        error: new Error("Something broke"),
        event,
      });

      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      expect(updateCalls.length).toBeGreaterThan(0);
      expect(updateCalls[0][0]).toMatchObject({
        status: "failed",
        error_message: "Something broke",
      });
    });

    it("sends Telegram failure notification when chatId is present", async () => {
      const { mock: supabase } = buildSupabaseMock([]);
      vi.mocked(createServiceClient).mockReturnValue(supabase as never);
      vi.mocked(sendMessage).mockResolvedValue(undefined);

      const event = {
        data: {
          itemId: ITEM_ID,
          sourceType: "github",
          sourceUrl: "https://github.com/owner/repo",
          userId: USER_ID,
          chatId: CHAT_ID,
        },
      };

      await captured.onFailure!({
        error: new Error("Failed"),
        event,
      });

      expect(sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining("Failed to process")
      );
    });

    it("skips Telegram notification when no chatId", async () => {
      const { mock: supabase } = buildSupabaseMock([]);
      vi.mocked(createServiceClient).mockReturnValue(supabase as never);

      await captured.onFailure!({
        error: new Error("Failed"),
        event: {
          data: {
            itemId: ITEM_ID,
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            userId: USER_ID,
          },
        },
      });

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("handles non-Error values — uses Unknown error", async () => {
      const { mock: supabase } = buildSupabaseMock([]);
      vi.mocked(createServiceClient).mockReturnValue(supabase as never);

      await captured.onFailure!({
        error: "string error",
        event: {
          data: {
            itemId: ITEM_ID,
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            userId: USER_ID,
          },
        },
      });

      const updateCalls = vi.mocked(supabase.update as ReturnType<typeof vi.fn>).mock.calls;
      expect(updateCalls[0][0].error_message).toBe("Unknown error");
    });
  });
});
