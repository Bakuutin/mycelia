import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zObjectId } from "@myceliasdk/zod-json-schema.ts";
import {
  getInferenceProvenance,
  type InferenceProvenance,
  summarizeInferenceUsage,
} from "@/lib/llm/provenance.ts";
import { createPromptCacheSessionId } from "@/lib/llm/prompt-cache-session.ts";
import { assertCompletionNotTruncated } from "@/lib/llm/completion-response.ts";
import {
  buildJsonSchemaResponseFormat,
  ENTITY_TYPE_FLAG,
  ENTITY_TYPES,
  type EntityType,
  hasAnyTypeFlagKey,
  resolveWorkerFallbackModel,
  TYPE_FLAG_FIELDS,
} from "./conversationExtractor.ts";

/**
 * Entity Typing Worker
 *
 * Backfill classifier for objects that have no type flags (the "other"
 * bucket): entities created by conversation extraction before typed
 * extraction existed, or anything the LLM previously could not classify.
 *
 * - Batches many entities into a single LLM call (batchSize per request).
 * - Never overrides a manual typing decision: any existing type-flag key on
 *   a document (even an explicit false) marks it as user-typed and skips it.
 * - Idempotent: every attempted object gets a
 *   metadata.aiProvenance.entityTyping marker (including "other" results),
 *   so re-runs only touch never-attempted objects unless force=true.
 * - Manual-only: no triggers; run it from the Jobs page. Returns hasMore to
 *   self-continue through large backlogs via job chaining.
 */

// ============================================================================
// Types
// ============================================================================

interface EntityDoc {
  _id: ObjectId;
  version?: number;
  name?: string;
  details?: string;
  aliases?: string[];
  metadata?: {
    aiProvenance?: {
      entityTyping?: {
        type?: string;
        setFlag?: string | null;
      };
    };
  };
  [key: string]: unknown;
}

// ============================================================================
// Schema
// ============================================================================

const DEFAULT_TYPING_PROMPT =
  `You classify named entities from a personal knowledge graph into types.

For each entity you receive an id, a name, and optionally aliases and details.
Classify each entity as exactly one of:
- "person": an individual human
- "place": a physical location (city, country, venue, address, region)
- "organization": a company, institution, team, or group of people
- "product": a product, app, service, brand of goods, or piece of software
- "project": a named project or initiative
- "event": a named event, gathering, conference, festival, or party
- "animal": an animal or pet
- "concept": an abstract concept, topic, technology, language, or idea
- "media": a creative work (book, film, series, song, game, article) or fictional character
- "other": anything else, or when you are not reasonably confident

Return JSON: {"classifications": [{"id": "<id>", "type": "<type>"}]} with one
entry per input entity, using the exact id you were given. When unsure, prefer
"other" over guessing.`;

export const schema = z.object({
  type: z.literal("entity_typing"),
  objectIds: z.array(zObjectId()).max(500).optional()
    .describe(
      "Explicit object ids to classify; overrides the untyped-objects scan",
    ),
  limit: z.number().min(1).max(2000).default(200)
    .describe("Max objects processed per job run (continues via hasMore)"),
  batchSize: z.number().min(1).max(100).default(40)
    .describe("Entities classified per LLM call"),
  model: z.string().default("small"),
  fallbackModel: z.string().optional()
    .describe(
      "Optional model retried once after a primary LLM error; leave empty to use the provider route's configured fallback",
    ),
  providerProfileId: z.string().optional()
    .describe(
      "Pin the LLM call to one provider profile (no cross-provider failover)",
    ),
  force: z.boolean().default(false)
    .describe(
      "Re-classify objects already attempted by this worker; never overrides flags a user set manually",
    ),
  maxTokens: z.number().int().min(256).max(32768).default(4096)
    .describe(
      "Output-token cap per classification call; a truncated response fails loudly with LLM_TRUNCATED_RESPONSE",
    ),
  reasoning: z.enum(["off", "default"]).default("off")
    .describe(
      "Reasoning/thinking mode for the LLM call; recorded in provenance for later analysis",
    ),
  typing_system_prompt: z.string().default(DEFAULT_TYPING_PROMPT)
    .describe("System prompt for the batch classification call"),
});

export type EntityTypingJobData = z.infer<typeof schema>;

// ============================================================================
// Pure Functions
// ============================================================================

export function buildUntypedScanFilters(force: boolean): Record<string, any> {
  const filters: Record<string, any> = {
    name: { $exists: true, $ne: "" },
  };
  for (const field of TYPE_FLAG_FIELDS) {
    filters[field] = { $exists: false };
  }
  if (!force) {
    filters["metadata.aiProvenance.entityTyping"] = { $exists: false };
  }
  return filters;
}

/**
 * Whether this worker may (re)write type flags on the document.
 * - No type-flag key at all: yes.
 * - Flags present: only when force=true AND the flags are exactly the one
 *   this worker set earlier (recorded in the provenance marker) — anything
 *   else means a human decided, and we never override that.
 */
export function canRewriteDoc(doc: EntityDoc, force: boolean): boolean {
  if (!hasAnyTypeFlagKey(doc)) return true;
  if (!force) return false;
  const marker = doc.metadata?.aiProvenance?.entityTyping;
  if (!marker) return false;
  const presentFlags = TYPE_FLAG_FIELDS.filter(
    (field) => field in doc && doc[field] !== undefined,
  );
  return presentFlags.length === 1 && presentFlags[0] === marker.setFlag &&
    doc[presentFlags[0]] === true;
}

export function formatEntitiesForPrompt(batch: EntityDoc[]): string {
  return JSON.stringify(
    batch.map((doc) => ({
      id: doc._id.toString(),
      name: doc.name,
      ...(doc.aliases?.length ? { aliases: doc.aliases } : {}),
      ...(doc.details
        ? { details: String(doc.details).slice(0, 200) }
        : {}),
    })),
  );
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
  } catch (_e) {
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

export function parseTypingResponse(
  content: string,
  validIds: Set<string>,
): Map<string, EntityType> {
  const parsed = extractJsonFromText(content);
  const classifications = parsed.classifications ?? parsed ?? [];
  const result = new Map<string, EntityType>();

  if (!Array.isArray(classifications)) return result;

  for (const entry of classifications) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    const type = (entry as { type?: unknown }).type;
    if (typeof id !== "string" || !validIds.has(id)) continue;
    if (
      typeof type !== "string" ||
      !(ENTITY_TYPES as readonly string[]).includes(type)
    ) continue;
    if (!result.has(id)) result.set(id, type as EntityType);
  }

  return result;
}

// ============================================================================
// Main Worker
// ============================================================================

const capability: JobCapability = {
  name: "entity_typing",
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("completed"),
    success: z.boolean(),
    processed: z.number(),
    classified: z.number(),
    flagsSet: z.number(),
    markedOther: z.number(),
    skipped: z.number(),
    hasMore: z.boolean(),
    artifacts: z.array(z.object({
      objectId: z.string(),
      name: z.string(),
      type: z.string(),
      setFlag: z.string().nullable(),
    })).optional().describe(
      "Per-object classification results for review on the job details page",
    ),
    errors: z.array(z.object({
      type: z.string(),
      message: z.string(),
      objectId: z.string().optional(),
    })).optional(),
  })),
  policies: [
    { resource: "objects", action: "*", effect: "allow" },
    { resource: "llm/chat", action: "completions", effect: "allow" },
  ],
  maxConcurrency: 1,
  use: async (job) => {
    const input = job.data as EntityTypingJobData;
    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = Deno.env.get("MYCELIA_URL")!;

    const objects = (input: any) =>
      callResource("objects", input, { jwt, myceliaUrl });
    const llm = (input: any) => callResource("llm", input, { jwt, myceliaUrl });

    const errors: Array<
      { type: string; message: string; objectId?: string }
    > = [];
    let processed = 0;
    let classified = 0;
    let flagsSet = 0;
    let markedOther = 0;
    let skipped = 0;
    const inferenceRuns: InferenceProvenance[] = [];
    const artifacts: Array<{
      objectId: string;
      name: string;
      type: EntityType;
      setFlag: string | null;
    }> = [];

    // Step 1: Select candidates
    const explicitIds = input.objectIds?.map((id: ObjectId | string) =>
      id instanceof ObjectId ? id : new ObjectId(id.toString())
    );
    const filters = explicitIds?.length
      ? { _id: { $in: explicitIds } }
      : buildUntypedScanFilters(input.force);

    const candidates = await objects({
      action: "list",
      filters,
      options: { limit: input.limit + 1, sort: { _id: 1 } },
    }) as EntityDoc[];

    const hasMore = !explicitIds?.length && candidates.length > input.limit;
    const selected = candidates.slice(0, input.limit);

    // The scan query cannot express the force-rewrite rules; guard per-doc.
    const toProcess = selected.filter((doc) => {
      if (canRewriteDoc(doc, input.force)) return true;
      skipped++;
      return false;
    });

    console.log(
      `[EntityTyping] Job ${job.id}: ${toProcess.length} objects to classify (${skipped} skipped, hasMore=${hasMore})`,
    );

    if (toProcess.length === 0) {
      return {
        status: "completed" as const,
        success: true,
        processed: 0,
        classified: 0,
        flagsSet: 0,
        markedOther: 0,
        skipped,
        hasMore,
      };
    }

    const responseFormat = buildJsonSchemaResponseFormat(
      "entity_classifications",
      z.object({
        classifications: z.array(z.object({
          id: z.string(),
          type: z.enum(ENTITY_TYPES),
        })),
      }).toJSONSchema() as Record<string, unknown>,
    );

    // Step 2: Classify in batches — one LLM call per batch
    const totalBatches = Math.ceil(toProcess.length / input.batchSize);
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batch = toProcess.slice(
        batchIndex * input.batchSize,
        (batchIndex + 1) * input.batchSize,
      );

      await job.updateProgress({
        stage: "classifying",
        batch: batchIndex + 1,
        totalBatches,
        processed,
        ...(inferenceRuns.length > 0
          ? { inference: summarizeInferenceUsage(inferenceRuns) }
          : {}),
      });

      const fallbackModel = resolveWorkerFallbackModel(
        input.fallbackModel,
        "ENTITY_TYPING_FALLBACK_MODEL",
      );
      let typeById: Map<string, EntityType>;
      let provenance: InferenceProvenance;
      try {
        const entitiesPrompt = formatEntitiesForPrompt(batch);
        const response = await llm({
          action: "completions",
          model: input.model,
          // Omit rather than pass undefined: EJSON turns undefined into null.
          ...(fallbackModel ? { fallbackModel } : {}),
          ...(input.providerProfileId
            ? { provider_profile_id: input.providerProfileId }
            : {}),
          ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
          reasoning: input.reasoning ?? "off",
          category: "entity-typing",
          session_id: createPromptCacheSessionId("entity-typing", {
            system: input.typing_system_prompt,
            responseFormat,
            reasoning: input.reasoning ?? "off",
          }),
          messages: [
            { role: "system", content: input.typing_system_prompt },
            { role: "user", content: `Entities:\n${entitiesPrompt}` },
          ],
          response_format: responseFormat,
        }) as any;

        // A truncated batch response silently drops the tail entities —
        // fail loudly so the batch size / cap can be fixed.
        assertCompletionNotTruncated(response, {
          requestedModel: input.model,
          maxTokens: input.maxTokens,
          purpose: `entity typing batch ${batchIndex + 1}`,
        });

        provenance = getInferenceProvenance(
          response,
          input.model,
          fallbackModel,
        );
        inferenceRuns.push(provenance);

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }
        const validIds = new Set(batch.map((doc) => doc._id.toString()));
        typeById = parseTypingResponse(content, validIds);
      } catch (error) {
        console.error(
          `[EntityTyping] Job ${job.id}: batch ${batchIndex + 1} failed:`,
          error,
        );
        errors.push({
          type: "llm_batch",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      // Step 3: Persist classifications
      for (const doc of batch) {
        const id = doc._id.toString();
        const entityType = typeById.get(id);
        if (!entityType) {
          // LLM omitted this entity — leave it untouched so a re-run retries.
          skipped++;
          continue;
        }

        try {
          const flagField = ENTITY_TYPE_FLAG[entityType];
          let fresh = await objects({ action: "get", id }) as EntityDoc;
          if (!canRewriteDoc(fresh, input.force)) {
            skipped++;
            continue;
          }

          const priorFlag = fresh.metadata?.aiProvenance?.entityTyping?.setFlag;
          if (priorFlag && priorFlag !== flagField && fresh[priorFlag]) {
            await objects({
              action: "update",
              id,
              version: fresh.version ?? 0,
              field: priorFlag,
              value: null,
            });
            fresh = await objects({ action: "get", id }) as EntityDoc;
          }

          if (flagField && fresh[flagField] !== true) {
            await objects({
              action: "update",
              id,
              version: fresh.version ?? 0,
              field: flagField,
              value: true,
            });
            fresh = await objects({ action: "get", id }) as EntityDoc;
          }

          // Written even for "other": this marker is what makes re-runs skip
          // already-attempted objects.
          await objects({
            action: "update",
            id,
            version: fresh.version ?? 0,
            field: "metadata.aiProvenance.entityTyping",
            value: {
              task: "entity_typing",
              type: entityType,
              setFlag: flagField ?? null,
              jobId: job.id,
              generatedAt: new Date(),
              ...provenance,
            },
          });

          processed++;
          classified++;
          if (flagField) {
            flagsSet++;
          } else {
            markedOther++;
          }
          artifacts.push({
            objectId: id,
            name: doc.name ?? "Unnamed",
            type: entityType,
            setFlag: flagField ?? null,
          });
        } catch (error) {
          console.error(
            `[EntityTyping] Job ${job.id}: failed to persist ${id}:`,
            error,
          );
          errors.push({
            type: "persist",
            message: error instanceof Error ? error.message : String(error),
            objectId: id,
          });
        }
      }
    }

    // Nothing succeeded and there were errors: fail the job instead of
    // reporting a green "completed" run that silently did no work.
    if (processed === 0 && errors.length > 0) {
      throw new Error(
        `entity_typing failed: 0 objects classified, ${errors.length} error(s); first: ${
          errors[0].message
        }`,
      );
    }

    console.log(
      `[EntityTyping] Job ${job.id}: completed - processed=${processed}, flagsSet=${flagsSet}, markedOther=${markedOther}, skipped=${skipped}, errors=${errors.length}`,
    );

    const inference = summarizeInferenceUsage(inferenceRuns);
    return {
      status: "completed" as const,
      success: errors.length === 0,
      processed,
      classified,
      flagsSet,
      markedOther,
      skipped,
      hasMore,
      ...(artifacts.length > 0 ? { artifacts } : {}),
      ...(inference ? { inference } : {}),
      ...(errors.length > 0 && { errors }),
    };
  },
};

export default capability;
