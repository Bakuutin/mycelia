import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString, zObjectId } from "@myceliasdk/zod-json-schema.ts";
import {
  getInferenceProvenance,
  type InferenceProvenance,
} from "@/lib/llm/provenance.ts";
import { createPromptCacheSessionId } from "@/lib/llm/prompt-cache-session.ts";

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
 *    │  3. For each untagged conversation:                             │
 *    │     a. Get conversation summary/name                            │
 *    │     b. Call LLM with tag list + conversation context            │
 *    │     c. LLM returns applicable tag names                         │
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

type TaggingLLMResult = {
  tags: string[];
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
  limit: z.number().default(1),
  model: z.string().default("small"),
  fallbackModel: z.string()
    .default(Deno.env.get("TAGGER_FALLBACK_MODEL") ?? "")
    .describe(
      "Optional model retried once after a primary LLM error; empty means stop with error",
    ),
  force: z.boolean().default(false),
  minTags: z.number().default(0),
  maxTags: z.number().default(5),
  minLength: z.number().default(10).describe(
    "Minimum length of a conversation in seconds to be considered for tagging",
  ),
  system_prompt: z.string()
    .default(
      `You are a tagging assistant. Given a conversation title, summary, and a list of available tags, determine which tags apply to this conversation.

Rules:
- Only select tags that are clearly relevant to the conversation content
- Be conservative - only apply tags when you're confident they match
- Return an empty array if no tags apply
- Return tag names exactly as provided (case-sensitive)

Output JSON with a single field "tags" containing an array of applicable tag names.`,
    )
    .describe("System prompt for the LLM tagging call"),
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

function parseTagsResponse(
  content: string,
  validTagNames: Set<string>,
): string[] {
  const parsed = extractJsonFromText(content);
  const tags = parsed.tags || parsed || [];

  if (!Array.isArray(tags)) {
    return [];
  }

  // Filter to only valid tag names
  return tags.filter((tag: any) =>
    typeof tag === "string" && validTagNames.has(tag)
  );
}

// ============================================================================
// LLM Operations
// ============================================================================

async function callLLMForTags(
  llm: (input: any) => Promise<any>,
  model: string,
  fallbackModel: string,
  systemPrompt: string,
  tagsPrompt: string,
  conversationPrompt: string,
  validTagNames: Set<string>,
  logContext: string,
): Promise<TaggingLLMResult> {
  const responseFormat = {
    type: "json_schema" as const,
    json_schema: z.object({ tags: z.array(z.string()) }).toJSONSchema(),
  };
  const response = await llm({
    action: "completions",
    model,
    fallbackModel,
    session_id: createPromptCacheSessionId("tagger", {
      system: systemPrompt,
      tags: tagsPrompt,
      responseFormat,
    }),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: tagsPrompt },
      {
        role: "user",
        content: `Conversation:\n${conversationPrompt}`,
      },
    ],
    response_format: responseFormat,
  }) as any;

  const content = response.choices[0]?.message?.content;
  const provenance = getInferenceProvenance(response, model, fallbackModel);
  if (!content) {
    console.log(`[Tagger] ${logContext}: EMPTY response from LLM`);
    return { tags: [], provenance, parseStatus: "empty" };
  }

  const truncatedContent = content.length > 300
    ? content.slice(0, 300) + "..."
    : content;
  console.log(`[Tagger] ${logContext}: raw response: ${truncatedContent}`);

  try {
    return {
      tags: parseTagsResponse(content, validTagNames),
      provenance,
      parseStatus: "ok",
    };
  } catch (error) {
    console.log(`[Tagger] ${logContext}: parse failed: ${error}`);
    return {
      tags: [],
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
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("completed"),
    success: z.boolean(),
    conversationsProcessed: z.number(),
    processed: z.number(),
    tagsApplied: z.number(),
    hasMore: z.boolean(),
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

    // Step 3: Fetch conversations
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
      : conversationQuery;

    const allConversations = await objects({
      action: "list",
      filters: conversationFilters,
      options: { sort: { "timeRanges.start": -1 } },
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
      // Normal mode: only process untagged conversations
      const taggedConversationIds = new Set<string>();

      // Find all "tagged" relationships where subject is a conversation
      const tagRelationships = await objects({
        action: "list",
        filters: {
          isRelationship: true,
          name: "tagged",
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

    // Step 5: Process each conversation
    for (let i = 0; i < conversationsToProcess.length; i++) {
      const conversation = conversationsToProcess[i];

      await job.updateProgress({
        stage: "tagging",
        current: i + 1,
        total: conversationsToProcess.length,
        conversationId: conversation._id.toString(),
      });

      try {
        // If force mode, delete existing tag relationships for this conversation
        if (input.force) {
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

        // Format conversation for LLM
        const conversationPrompt = formatConversationForPrompt(conversation);

        // Call LLM to determine applicable tags
        const taggingResult = await callLLMForTags(
          llm,
          input.model,
          input.fallbackModel,
          input.system_prompt,
          tagsPrompt,
          conversationPrompt,
          validTagNames,
          `Conv ${conversation._id}`,
        );
        const applicableTags = taggingResult.tags;

        // Apply min/max constraints
        const tagsToApply = applicableTags.slice(0, input.maxTags);

        console.log(
          `[Tagger] Conv ${conversation._id} "${conversation.name}": LLM suggested ${applicableTags.length} tags: [${
            tagsToApply.join(", ")
          }]`,
        );

        const generatedAt = new Date();
        const taggingRun = {
          task: "tagging",
          ...taggingResult.provenance,
          parseStatus: taggingResult.parseStatus,
          parseError: taggingResult.parseError,
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
            console.log(
              `[Tagger] Conv ${conversation._id}: applied tag "${tagName}"`,
            );
          } catch (error) {
            console.error(
              `[Tagger] Failed to apply tag "${tagName}" to conversation ${conversation._id}:`,
              error,
            );
            errors.push({
              type: "tag_relationship",
              message: error instanceof Error ? error.message : String(error),
              conversationId: conversation._id.toString(),
            });
          }
        }

        // Persist the run on the conversation as well. This records valid
        // zero-tag outcomes, which otherwise leave no relationship artifact.
        const latestConversation = await objects({
          action: "get",
          id: conversation._id.toString(),
        }) as Conversation;
        const priorRuns = latestConversation.metadata?.aiProvenance
          ?.taggingRuns ?? [];
        await objects({
          action: "update",
          id: conversation._id.toString(),
          version: latestConversation.version ?? 0,
          field: "metadata.aiProvenance.taggingRuns",
          value: [...priorRuns, taggingRun],
        });

        conversationsProcessed++;
      } catch (error) {
        console.error(
          `[Tagger] Failed to process conversation ${conversation._id}:`,
          error,
        );
        errors.push({
          type: "processing",
          message: error instanceof Error ? error.message : String(error),
          conversationId: conversation._id.toString(),
        });
      }
    }

    console.log(
      `[Tagger] Job ${job.id}: completed - processed ${conversationsProcessed} conversations, applied ${tagsApplied} tags`,
    );

    return {
      status: "completed" as const,
      success: errors.length === 0,
      conversationsProcessed,
      processed: conversationsProcessed,
      tagsApplied,
      hasMore,
      ...(errors.length > 0 && { errors }),
    };
  },
};

export default capability;
