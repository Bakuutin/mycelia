import { expect } from "@std/expect";
import tagger, {
  buildTaggerConversationQuery,
  parseBatchTagsResponse,
  schema,
} from "./tagger.ts";

const VALID = new Set(["work", "family", "technology"]);
const IDS = ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"];

Deno.test("tagger schema defaults include batching", () => {
  const input = schema.parse({ type: "tagger" });
  expect(input.batchSize).toBe(5);
  expect(input.maxTokens).toBe(1536);
  expect(input.reasoning).toBe("off");
});

Deno.test("tagger selection uses the generated marker subfield", () => {
  expect(buildTaggerConversationQuery()).toEqual({
    isConversation: true,
    "metadata.aiProvenance.taggingRuns.0.generatedAt": { $exists: false },
  });
});

Deno.test("tagger preflight skips work when no tags are configured", async () => {
  const calls: any[] = [];
  const pending = await tagger.hasPendingWork?.({
    mongo: async (input) => {
      calls.push(input);
      return [];
    },
    reason: "interval",
  });

  expect(pending).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0].query).toEqual({ isTag: true });
});

Deno.test("batch response maps ids to valid tags only", () => {
  const content = JSON.stringify({
    results: [
      { id: IDS[0], tags: ["work", "hallucinated", 42] },
      { id: IDS[1], tags: [] },
      { id: "unknown-id", tags: ["family"] },
      { id: IDS[0], tags: ["family"] }, // duplicate id ignored
    ],
  });
  const byId = parseBatchTagsResponse(content, VALID, IDS);
  expect(byId.get(IDS[0])).toEqual(["work"]);
  expect(byId.get(IDS[1])).toEqual([]);
  expect(byId.size).toBe(2);
});

Deno.test("batch response tolerates markdown fences and bare arrays", () => {
  const fenced = "```json\n" + JSON.stringify({
    results: [{ id: IDS[0], tags: ["technology"] }],
  }) + "\n```";
  expect(parseBatchTagsResponse(fenced, VALID, IDS).get(IDS[0])).toEqual([
    "technology",
  ]);

  const bare = JSON.stringify([{ id: IDS[1], tags: ["family"] }]);
  expect(parseBatchTagsResponse(bare, VALID, IDS).get(IDS[1])).toEqual([
    "family",
  ]);
});

Deno.test("omitted ids stay absent so callers can record them", () => {
  const content = JSON.stringify({
    results: [{ id: IDS[0], tags: ["work"] }],
  });
  const byId = parseBatchTagsResponse(content, VALID, IDS);
  expect(byId.has(IDS[1])).toBe(false);
});

Deno.test("garbage response throws for the caller to classify", () => {
  expect(() => parseBatchTagsResponse("no json here", VALID, IDS)).toThrow();
});
