import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString, zObjectId } from "@myceliasdk/zod-json-schema.ts";
import {
  getInferenceProvenance,
  type InferenceProvenance,
  summarizeInferenceUsage,
} from "@/lib/llm/provenance.ts";
import { createPromptCacheSessionId } from "@/lib/llm/prompt-cache-session.ts";
import { resolveWorkerFallbackModel } from "@/lib/llm/worker-response.ts";
import { assertCompletionNotTruncated } from "@/lib/llm/completion-response.ts";
import { getTriggerTiming } from "@/lib/jobs/trigger-config.ts";

/**
 * Tagger Worker
 *
 * This worker automatically applies tags to conversations that don't have any tags yet.
 * It operates on conversations within a specified date range.
 *
 * ============================================================================
 * ARCHITECTURE
 * ============================================================================
 *
 * 1. TAG SYSTEM
 *    - Tags are objects with `isTag: true` in the database
 *    - Each tag has a `name` (required) and optional `details` (description)
 *    - Tags can have icons, colors, etc. like any other object
 *
 * 2. TAG RELATIONSHIPS
 *    - Tags are linked to conversations via relationship objects
 *    - Relationship: { isRelationship: true, name: "tagged", relationship: { subject: conversationId, object: tagId, symmetrical: false } }
 *    - A conversation can have multiple tags
 *    - The relationship is directional: conversation -> tag
 *
 * 3. PROCESSING FLOW
 *    ┌─────────────────────────────────────────────────────────────────┐
 *    │  1. Fetch all tags (objects with isTag: true)                   │
 *    │     - Extract name and details for LLM context                  │
 *    └─────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 *    ┌─────────────────────────────────────────────────────────────────┐
 *    │  2. Find untagged conversations in date range                   │
 *    │     - Query conversations with timeRanges overlapping range     │
 *    │     - Exclude those with existing "tagged" relationships        │
 *    └─────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    ▼
 *    ┌─────────────────────────────────────────────────────────────────┐
 *    │  3. For each BATCH of untagged conversations (batchSize):       │
 *    │     a. Get each conversation's summary/name                     │
 *    │     b. One LLM call: tag list + all conversations with ids      │
 *    │     c. LLM returns {"results": [{id, tags}]} per conversation   │
 *    │     d. Create "tagged" relationship for each applicable tag     │
 *    └─────────────────────────────────────────────────────────────────┘
 *
 * 4. LLM PROMPT STRUCTURE
 *    - System: Instructions for tag matching
 *    - User: List of available tags + conversation name/summary
 *    - Response: JSON array of applicable tag names
 *
 * 5. IDEMPOTENCY
 *    - Worker checks for existing tag relationships before processing
 *    - If force=true, existing tag relationships are deleted first
 *    - Processing is safe to retry
 *
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 *
 * Input Schema:
 *   - type: "tagger" (literal)
 *   - start: Date - start of date range (optional, defaults to all time)
 *   - end: Date - end of date range (optional, defaults to now)
 *   - limit: number - max conversations to process per run (default: 10)
 *   - model: string - LLM model to use (default: provider's default)
 *   - force: boolean - re-tag already tagged conversations (default: false)
 *   - minTags: number - minimum tags to apply (default: 0)
 *   - maxTags: number - maximum tags to apply (default: 5)
 *   - system_prompt: string - custom system prompt for LLM
 *
 * Output:
 *   - status: "completed"
 *   - success: boolean
 *   - conversationsProcessed: number
 *   - tagsApplied: number
 *   - hasMore: boolean
 *   - errors: array of error objects (if any)
 */

// ============================================================================
// Types
// ============================================================================

interface Tag {
  _id: ObjectId;
  name: string;
  details?: string;
}

interface Conversation {
  _id: ObjectId;
  version?: number;
  name: string;
  details?: string;
  summaries?: Array<{ text: string }>;
  timeRanges?: Array<{ start: Date; end?: Date }>;
  metadata?: {
    aiProvenance?: {
      taggingRuns?: Array<Record<string, unknown>>;
    };
  };
}

type BatchTaggingLLMResult = {
  // Valid tag names per conversation id; ids the model omitted are absent.
  byId: Map<string, string[]>;
  provenance: InferenceProvenance;
  parseStatus: "ok" | "empty" | "parse_error";
  parseError?: string;
};

// ============================================================================
// Schema
// ============================================================================

export const schema = z.object({
  type: z.literal("tagger"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  objectIds: z.array(zObjectId()).max(100).optional()
    .describe("Optional exact conversation IDs for targeted re-tagging"),
  limit: z.number().default(10)
    .describe(
      "Conversations tagged per run; large backlogs self-continue via hasMore",
    ),
  batchSize: z.number().int().min(1).max(20).default(5)
    .describe(
      "Conversations tagged per LLM call — the tag list is sent once per batch (like entity_typing)",
    ),
  model: z.string().default("small"),
  fallbackModel: z.string().optional()
    .describe(
      "Optional model retried once after a primary LLM error; leave empty to use the provider route's configured fallback",
    ),
  providerProfileId: z.string().optional()
    .describe(
      "Pin the LLM call to one provider profile (no cross-provider failover)",
    ),
  force: z.boolean().default(false),
  maxTokens: z.number().int().min(256).max(32768).default(1536)
    .describe(
      "Output-token cap per tagging call (covers a whole batch); a truncated response fails loudly with LLM_TRUNCATED_RESPONSE",
    ),
  reasoning: z.enum(["off", "default", "on"]).default("off")
    .describe(
      "Reasoning/thinking mode for the LLM call; recorded in provenance for later analysis",
    ),
  minTags: z.number().default(0),
  maxTags: z.number().default(5),
  minLength: z.number().default(10).describe(
    "Minimum length of a conversation in seconds to be considered for tagging",
  ),
  system_prompt: z.string()
    .default(
      `You are a tagging assistant. You receive a list of available tags and several conversations (each with an id, title and optional summary). For every conversation, determine which tags apply.

Rules:
- Only select tags that are clearly relevant to the conversation content
- Be conservative - only apply tags when you're confident they match
- Use an empty array when no tags apply to a conversation
- Return tag names exactly as provided (case-sensitive)
- Return one entry per input conversation, using the exact id you were given

Output JSON: {"results": [{"id": "<conversation id>", "tags": ["tag", ...]}]}`,
    )
    .describe("System prompt for the batched LLM tagging call"),
});

export type TaggerJobData = z.infer<typeof schema>;

// ============================================================================
// Pure Functions
// ============================================================================

function formatTagsForPrompt(tags: Tag[]): string {
  if (tags.length === 0) {
    throw new Error("No tags available.");
  }

  const lines = tags.map((tag) => {
    if (tag.details) {
      return `- ${tag.name}: ${tag.details}`;
    }
    return `- ${tag.name}`;
  });

  return `Available tags:\n${lines.join("\n")}`;
}

function formatConversationForPrompt(conversation: Conversation): string {
  const parts: string[] = [];

  parts.push(`Title: ${conversation.name}`);

  if (conversation.details) {
    parts.push(`Details: ${conversation.details}`);
  }

  // Use the most recent summary if available
  if (conversation.summaries && conversation.summaries.length > 0) {
    const latestSummary =
      conversation.summaries[conversation.summaries.length - 1];
    parts.push(`Summary: ${latestSummary.text}`);
  }

  return parts.join("\n");
}

function stripMarkdownCodeBlock(content: string): string {
  let cleaned = content.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

function extractJsonFromText(content: string): any {
  const cleaned = stripMarkdownCodeBlock(content);

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Continue to more robust extraction
  }

  const jsonStart = Math.min(
    cleaned.indexOf("{") >= 0 ? cleaned.indexOf("{") : Infinity,
    cleaned.indexOf("[") >= 0 ? cleaned.indexOf("[") : Infinity,
  );

  if (jsonStart === Infinity) {
    throw new Error(`No JSON found in response: ${cleaned.slice(0, 200)}`);
  }

  const startChar = cleaned[jsonStart];
  const endChar = startChar === "{" ? "}" : "]";
  let depth = 0;
  let jsonEnd = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = jsonStart; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }

  if (jsonEnd === -1) {
    throw new Error("Could not find complete JSON in response");
  }

  return JSON.parse(cleaned.substring(jsonStart, jsonEnd));
}

/**
 * Parses the batched response {"results": [{"id", "tags"}]} into a map of
 * conversation id → valid tag names. Unknown ids, duplicate ids and invalid
 * tag names are dropped; ids the model omitted are simply absent so the
 * caller can record them explicitly.
 */
export function parseBatchTagsResponse(
  content: string,
  validTagNames: Set<string>,
  expectedIds: readonly string[],
): Map<string, string[]> {
  const parsed = extractJsonFromText(content);
  const results = Array.isArray(parsed?.results)
    ? parsed.results
    : Array.isArray(parsed)
    ? parsed
    : [];
  const expected = new Set(expectedIds);
  const byId = new Map<string, string[]>();
  for (const entry of results) {
    if (!entry || typeof entry !== "object") continue;
    const id = String((entry as Record<string, unknown>).id ?? "");
    if (!expected.has(id) || byId.has(id)) continue;
    const rawTags = (entry as Record<string, unknown>).tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter((tag: unknown): tag is string =>
        typeof tag === "string" && validTagNames.has(tag)
      )
      : [];
    byId.set(id, tags);
  }
  return byId;
}

// ============================================================================
// LLM Operations
// ============================================================================

async function callLLMForTagsBatch(
  llm: (input: any) => Promise<any>,
  model: string,
  fallbackModel: string | undefined,
  providerProfileId: string | undefined,
  systemPrompt: string,
  tagsPrompt: string,
  batch: ReadonlyArray<{ id: string; prompt: string }>,
  validTagNames: Set<string>,
  logContext: string,
  options?: { maxTokens?: number; reasoning?: "off" | "default" | "on" },
): Promise<BatchTaggingLLMResult> {
  // Strict providers require the {name, schema} envelope around the schema.
  const responseFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: "conversation_tags_batch",
      schema: z.object({
        results: z.array(z.object({
          id: z.string(),
          tags: z.array(z.string()),
        })),
      }).toJSONSchema() as Record<string, unknown>,
    },
  };
  const conversationsPrompt = `Conversations:\n${
    batch.map((entry) => `--- id: ${entry.id}\n${entry.prompt}`).join("\n\n")
  }`;
  const response = await llm({
    action: "completions",
    model,
    // Omit rather than pass undefined: EJSON turns undefined into null.
    ...(fallbackModel ? { fallbackModel } : {}),
    ...(providerProfileId ? { provider_profile_id: providerProfileId } : {}),
    ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
    reasoning: options?.reasoning ?? "off",
    category: "tagging",
    session_id: createPromptCacheSessionId("tagger", {
      system: systemPrompt,
      tags: tagsPrompt,
      responseFormat,
      reasoning: options?.reasoning ?? "off",
    }),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: tagsPrompt },
      { role: "user", content: conversationsPrompt },
    ],
    response_format: responseFormat,
  }) as any;

  // A truncated batch is a configuration error — fail loudly instead of
  // silently tagging only the first conversations.
  assertCompletionNotTruncated(response, {
    requestedModel: model,
    maxTokens: options?.maxTokens,
    purpose: logContext,
  });

  const content = response.choices[0]?.message?.content;
  const provenance = getInferenceProvenance(response, model, fallbackModel);
  if (!content) {
    console.log(`[Tagger] ${logContext}: EMPTY response from LLM`);
    return { byId: new Map(), provenance, parseStatus: "empty" };
  }

  const truncatedContent = content.length > 300
    ? content.slice(0, 300) + "..."
    : content;
  console.log(`[Tagger] ${logContext}: raw response: ${truncatedContent}`);

  try {
    return {
      byId: parseBatchTagsResponse(
        content,
        validTagNames,
        batch.map((entry) => entry.id),
      ),
      provenance,
      parseStatus: "ok",
    };
  } catch (error) {
    console.log(`[Tagger] ${logContext}: parse failed: ${error}`);
    return {
      byId: new Map(),
      provenance,
      parseStatus: "parse_error",
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Main Worker
// ============================================================================

const capability: JobCapability = {
  name: "tagger",
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("completed"),
    success: z.boolean(),
    conversationsProcessed: z.number(),
    processed: z.number(),
    tagsApplied: z.number(),
    hasMore: z.boolean(),
    artifacts: z.array(z.object({
      conversationId: z.string(),
      title: z.string(),
      tags: z.array(z.string()),
      parseStatus: z.string(),
    })).optional().describe(
      "Per-conversation tagging outcomes for review on the job details page",
    ),
    errors: z.array(z.object({
      type: z.string(),
      message: z.string(),
      conversationId: z.string().optional(),
    })).optional(),
  })),
  policies: [
    { resource: "objects", action: "*", effect: "allow" },
    { resource: "llm/chat", action: "completions", effect: "allow" },
  ],
  maxConcurrency: 1,
  // The backfill drains via hasMore self-chaining, but one broken link (job
  // timeout, crash, backend restart) used to stop the whole chain silently —
  // tagger had no trigger, so an untagged backlog could sit for hours until
  // someone pressed Run now. The interval acts as a watchdog; the guard makes
  // idle ticks free.
  hasPendingWork: async ({ mongo }) => {
    const untagged = await mongo({
      action: "findOne",
      collection: "objects",
      query: {
        isConversation: true,
        "metadata.aiProvenance.taggingRuns.0": { $exists: false },
      },
      options: { projection: { _id: 1 } },
    });
    return Boolean(untagged);
  },
  triggers: {
    sources: [],
    ...getTriggerTiming("tagger"),
  },
  use: async (job) => {
    const input = job.data as TaggerJobData;
    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = Deno.env.get("MYCELIA_URL")!;

    const objects = (input: any) =>
      callResource("objects", input, { jwt, myceliaUrl });
    const llm = (input: any) => callResource("llm", input, { jwt, myceliaUrl });

    const errors: Array<
      { type: string; message: string; conversationId?: string }
    > = [];
    let conversationsProcessed = 0;
    let tagsApplied = 0;
    const inferenceRuns: InferenceProvenance[] = [];
    const artifacts: Array<{
      conversationId: string;
      title: string;
      tags: string[];
      parseStatus: string;
    }> = [];

    // Step 1: Fetch all tags
    console.log(`[Tagger] Job ${job.id}: fetching tags...`);
    const tags = await objects({
      action: "list",
      filters: { isTag: true },
    }) as Tag[];

    if (!tags || tags.length === 0) {
      console.log(`[Tagger] Job ${job.id}: no tags found in database`);
      return {
        status: "completed" as const,
        success: true,
        conversationsProcessed: 0,
        processed: 0,
        tagsApplied: 0,
        hasMore: false,
      };
    }

    console.log(`[Tagger] Job ${job.id}: found ${tags.length} tags`);
    const tagMap = new Map<string, ObjectId>(tags.map((t) => [t.name, t._id]));
    const validTagNames = new Set(tags.map((t) => t.name));
    const tagsPrompt = formatTagsForPrompt(tags);

    // Step 2: Build query for untagged conversations
    const dateFilter: Record<string, any> = {};
    if (input.start) dateFilter.$gte = new Date(input.start);
    if (input.end) dateFilter.$lt = new Date(input.end);

    const conversationQuery: Record<string, any> = {
      isConversation: true,
    };

    if (Object.keys(dateFilter).length > 0) {
      conversationQuery["timeRanges.start"] = dateFilter;
    }

    // Step 3: Fetch conversations. The untagged exclusion must live in the
    // query itself: the list action caps results, so an unfiltered fetch only
    // ever sees the newest ~1000 conversations — all long tagged — and a
    // 27k-deep backlog would never be reached.
    console.log(`[Tagger] Job ${job.id}: fetching conversations...`);
    const conversationFilters = input.objectIds?.length
      ? {
        _id: {
          $in: input.objectIds.map((id: ObjectId | string) =>
            id instanceof ObjectId ? id : new ObjectId(id.toString())
          ),
        },
        isConversation: true,
      }
      : input.force
      ? conversationQuery
      : {
        ...conversationQuery,
        "metadata.aiProvenance.taggingRuns.0": { $exists: false },
      };

    // Small buffer over the limit: a few candidates may still be dropped by
    // the edge check below (tagged edges without a taggingRuns marker).
    const fetchLimit = input.limit * 2 + 10;
    const allConversations = await objects({
      action: "list",
      filters: conversationFilters,
      options: { sort: { "timeRanges.start": -1 }, limit: fetchLimit },
    }) as Conversation[];

    if (!allConversations || allConversations.length === 0) {
      console.log(`[Tagger] Job ${job.id}: no conversations found in range`);
      return {
        status: "completed" as const,
        success: true,
        conversationsProcessed: 0,
        processed: 0,
        tagsApplied: 0,
        hasMore: false,
      };
    }

    console.log(
      `[Tagger] Job ${job.id}: found ${allConversations.length} conversations in range`,
    );

    // Step 4: Find conversations without tags (unless force=true)
    let conversationsToProcess: Conversation[];

    if (input.force) {
      // Force mode: process all conversations (delete existing tag relationships first)
      conversationsToProcess = allConversations.slice(0, input.limit + 1);
    } else {
      // Normal mode: only process untagged conversations. Scope the edge
      // lookup to the fetched candidates — an unscoped list is capped and
      // would silently miss edges.
      const taggedConversationIds = new Set<string>();

      const tagRelationships = await objects({
        action: "list",
        filters: {
          isRelationship: true,
          name: "tagged",
          "relationship.subject": {
            $in: allConversations.map((c) => c._id),
          },
          "relationship.object": { $in: tags.map((t) => t._id) },
        },
      }) as Array<{ relationship: { subject: ObjectId } }>;

      for (const rel of tagRelationships || []) {
        taggedConversationIds.add(rel.relationship.subject.toString());
      }

      conversationsToProcess = allConversations
        .filter((c) =>
          !taggedConversationIds.has(c._id.toString()) &&
          !(c.metadata?.aiProvenance?.taggingRuns?.length)
        )
        .slice(0, input.limit + 1);
    }

    const hasMore = conversationsToProcess.length > input.limit;
    conversationsToProcess = conversationsToProcess.slice(0, input.limit);

    console.log(
      `[Tagger] Job ${job.id}: processing ${conversationsToProcess.length} conversations, hasMore=${hasMore}`,
    );

    // Step 5: Tag conversations in batches — one LLM call covers batchSize
    // conversations and the tag list is sent once per call.
    const batches: Conversation[][] = [];
    for (let i = 0; i < conversationsToProcess.length; i += input.batchSize) {
      batches.push(conversationsToProcess.slice(i, i + input.batchSize));
    }
    const taggerFallbackModel = resolveWorkerFallbackModel(
      input.fallbackModel,
      "TAGGER_FALLBACK_MODEL",
    );

    let done = 0;
    for (const batch of batches) {
      await job.updateProgress({
        stage: "tagging",
        current: Math.min(done + batch.length, conversationsToProcess.length),
        total: conversationsToProcess.length,
        batchSize: batch.length,
        // Live routing info for the jobs list while the job is active.
        ...(inferenceRuns.length > 0
          ? { inference: summarizeInferenceUsage(inferenceRuns) }
          : {}),
      });
      done += batch.length;

      // If force mode, delete existing tag relationships first
      if (input.force) {
        for (const conversation of batch) {
          const existingRels = await objects({
            action: "list",
            filters: {
              isRelationship: true,
              name: "tagged",
              "relationship.subject": conversation._id,
            },
          }) as Array<{ _id: ObjectId }>;

          for (const rel of existingRels || []) {
            await objects({
              action: "delete",
              id: rel._id.toString(),
            });
          }
        }
      }

      const batchEntries = batch.map((conversation) => ({
        id: conversation._id.toString(),
        prompt: formatConversationForPrompt(conversation),
      }));

      let batchResult: BatchTaggingLLMResult;
      try {
        batchResult = await callLLMForTagsBatch(
          llm,
          input.model,
          taggerFallbackModel,
          input.providerProfileId,
          input.system_prompt,
          tagsPrompt,
          batchEntries,
          validTagNames,
          `Batch of ${batch.length} (job ${job.id})`,
          { maxTokens: input.maxTokens, reasoning: input.reasoning ?? "off" },
        );
        inferenceRuns.push(batchResult.provenance);
      } catch (error) {
        // Transport/truncation errors leave no tagging marker, so these
        // conversations are retried by a later run.
        console.error(`[Tagger] Batch call failed:`, error);
        for (const conversation of batch) {
          errors.push({
            type: "processing",
            message: error instanceof Error ? error.message : String(error),
            conversationId: conversation._id.toString(),
          });
        }
        continue;
      }

      for (const conversation of batch) {
        const conversationId = conversation._id.toString();
        try {
          const modelTags = batchResult.byId.get(conversationId);
          // Distinguish a broken call (empty/parse_error) from a parseable
          // response that omitted this id. Both get a marker with the status
          // recorded — mirroring the old per-conversation behavior where
          // parse failures counted as an attempt and were not retried
          // forever on the same content.
          const parseStatus = batchResult.parseStatus !== "ok"
            ? batchResult.parseStatus
            : modelTags === undefined
            ? "missing_in_batch"
            : "ok";
          const tagsToApply = (modelTags ?? []).slice(0, input.maxTags);

          console.log(
            `[Tagger] Conv ${conversationId} "${conversation.name}": ${parseStatus}, ${tagsToApply.length} tags: [${
              tagsToApply.join(", ")
            }]`,
          );

          const generatedAt = new Date();
          const taggingRun = {
            task: "tagging",
            ...batchResult.provenance,
            parseStatus,
            parseError: batchResult.parseError,
            selectedTags: tagsToApply,
            selectedTagCount: tagsToApply.length,
            jobId: job.id,
            generatedAt,
            forced: input.force,
          };

          // Create tag relationships
          for (const tagName of tagsToApply) {
            const tagId = tagMap.get(tagName);
            if (!tagId) continue;

            try {
              await objects({
                action: "create",
                object: {
                  isRelationship: true,
                  name: "tagged",
                  relationship: {
                    subject: conversation._id,
                    object: tagId,
                    symmetrical: false,
                  },
                  metadata: { generatedWith: taggingRun },
                },
              });
              tagsApplied++;
            } catch (error) {
              console.error(
                `[Tagger] Failed to apply tag "${tagName}" to conversation ${conversationId}:`,
                error,
              );
              errors.push({
                type: "tag_relationship",
                message: error instanceof Error ? error.message : String(error),
                conversationId,
              });
            }
          }

          // Persist the run on the conversation as well. This records valid
          // zero-tag outcomes, which otherwise leave no relationship artifact.
          const latestConversation = await objects({
            action: "get",
            id: conversationId,
          }) as Conversation;
          const priorRuns = latestConversation.metadata?.aiProvenance
            ?.taggingRuns ?? [];
          await objects({
            action: "update",
            id: conversationId,
            version: latestConversation.version ?? 0,
            field: "metadata.aiProvenance.taggingRuns",
            value: [...priorRuns, taggingRun],
          });

          conversationsProcessed++;
          artifacts.push({
            conversationId,
            title: conversation.name || "Untitled conversation",
            tags: tagsToApply,
            parseStatus,
          });
        } catch (error) {
          console.error(
            `[Tagger] Failed to process conversation ${conversationId}:`,
            error,
          );
          errors.push({
            type: "processing",
            message: error instanceof Error ? error.message : String(error),
            conversationId,
          });
        }
      }
    }

    console.log(
      `[Tagger] Job ${job.id}: completed - processed ${conversationsProcessed} conversations, applied ${tagsApplied} tags`,
    );

    const inference = summarizeInferenceUsage(inferenceRuns);
    return {
      status: "completed" as const,
      success: errors.length === 0,
      conversationsProcessed,
      processed: conversationsProcessed,
      tagsApplied,
      hasMore,
      ...(artifacts.length > 0 ? { artifacts } : {}),
      // Compact routing summary so the jobs list can show the provider and
      // model that actually served this job.
      ...(inference ? { inference } : {}),
      ...(errors.length > 0 && { errors }),
    };
  },
};

export default capability;
