import type { Job } from "bullmq";
import { z } from "zod";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { getJobTimeoutMs } from "@/lib/jobs/job-timeouts.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString, zObjectId } from "@myceliasdk/zod-json-schema.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { MongoRequest, MongoResponse } from "@/lib/mongo/core.server.ts";
import type {
  ObjectsRequest,
  ObjectsResponse,
} from "@/lib/objects/resource.server.ts";
import { getSummaryCompletionOptions } from "@/lib/llm/completion-options.ts";
import {
  getInferenceProvenance,
  type InferenceProvenance,
  summarizeInferenceUsage,
} from "@/lib/llm/provenance.ts";
import { getChatCompletionText } from "@/lib/llm/completion-response.ts";
import {
  buildJsonSchemaResponseFormat,
  resolveWorkerFallbackModel,
} from "./conversationExtractor.ts";
import { createPromptCacheSessionId } from "@/lib/llm/prompt-cache-session.ts";

/** Job type name */
export const name = "summarization";

/** Schema for summarization job data */
export const schema = z.object({
  type: z.literal("summarization"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  prompt: z.string()
    .default(
      "You are a helpful assistant. Summarize the following conversation transcript. Extract key points, topics discussed, decisions made, and any action items. Be concise but comprehensive.",
    )
    .describe(
      "System prompt for the summarization. This guides how the AI analyzes the conversation.",
    ),
  promptName: z.string().optional()
    .describe("Name of the prompt template used (for display in UI)"),
  model: z.string()
    .default("small")
    .describe(
      "LLM model alias to use for summarization (e.g., 'small', 'large', 'gpt-4o')",
    ),
  fallbackModel: z.string().optional()
    .describe(
      "Optional model retried once after a primary LLM error; leave empty to use the provider route's configured fallback",
    ),
  providerProfileId: z.string().optional()
    .describe(
      "Pin the LLM call to one provider profile (no cross-provider failover)",
    ),
  objectId: zObjectId().nullish(),
  allowExisting: z.boolean().default(false)
    .describe(
      "Append a new summary version even when the conversation already has summaries",
    ),
  retryNow: z.boolean().default(false)
    .describe(
      "Manual recovery: retry failed conversations immediately instead of waiting for backoff",
    ),
  minDurationForLlm: z.number()
    .default(10)
    .describe(
      "Minimum duration in seconds to use LLM. Shorter periods use transcript directly.",
    ),
  batchSize: z.number().int().min(1).max(100).default(25)
    .describe(
      "Conversations processed per automatic batch job. Ignored for manual (single-conversation) jobs.",
    ),
}).superRefine((value, ctx) => {
  const hasStart = value.start != null;
  const hasEnd = value.end != null;
  if (hasStart !== hasEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "start and end must both be provided together",
      path: hasStart ? ["end"] : ["start"],
    });
  }
});

export type SummarizationJobData = z.infer<typeof schema>;

export const summarySourceRefsSchema = z.object({
  schemaVersion: z.literal("v1"),
  selection: z.literal("time_range_overlap"),
  conversationId: z.string().optional(),
  conversationChunkIds: z.array(z.string()),
  transcriptionIds: z.array(z.string()),
  coverageStart: z.string(),
  coverageEnd: z.string(),
  extractorJobId: z.string().optional(),
});

export type SummarySourceRefs = z.infer<typeof summarySourceRefsSchema>;

type SummarySourceContext = {
  conversationId?: string;
  conversationChunkIds?: string[];
  extractorJobId?: string;
};

function stringId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (
    value && typeof (value as { toString?: unknown }).toString === "function"
  ) {
    const result = (value as { toString(): string }).toString();
    return result && result !== "[object Object]" ? result : null;
  }
  return null;
}

export function buildSummarySourceRefs(
  transcripts: Array<{ _id?: unknown }>,
  start: Date,
  end: Date,
  context: SummarySourceContext = {},
): SummarySourceRefs {
  return {
    schemaVersion: "v1",
    selection: "time_range_overlap",
    conversationId: context.conversationId,
    conversationChunkIds: Array.from(
      new Set((context.conversationChunkIds ?? []).filter(Boolean)),
    ),
    transcriptionIds: Array.from(
      new Set(
        transcripts.map((item) => stringId(item._id)).filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ),
    coverageStart: start.toISOString(),
    coverageEnd: end.toISOString(),
    extractorJobId: context.extractorJobId,
  };
}

function getConversationSourceContext(obj: any): SummarySourceContext {
  const conversationId = stringId(obj?._id) ?? undefined;
  const chunkId = stringId(obj?.metadata?.extractedWith?.chunkId);
  const extractorJobId = stringId(obj?.metadata?.extractedWith?.jobId) ??
    undefined;
  return {
    conversationId,
    conversationChunkIds: chunkId ? [chunkId] : [],
    extractorJobId,
  };
}

function getTimestampMessage(date: Date): string {
  return `[${date.toISOString()}]`;
}

function getSilenceMessage(gapMs: number): string {
  const duration = Math.round(gapMs / 1000 / 60);
  return `[Silence ${duration}m]`;
}

function hasNoSummaries(obj: any): boolean {
  return !Array.isArray(obj?.summaries) || obj.summaries.length === 0;
}

function getConversationRange(obj: any): { start: Date; end: Date } | null {
  const ranges = Array.isArray(obj?.timeRanges) ? obj.timeRanges : [];
  const parsed = ranges
    .map((range: any) => ({
      start: new Date(range.start),
      end: range.end ? new Date(range.end) : null,
    }))
    .filter((range: any) =>
      !isNaN(range.start.getTime()) && range.end && !isNaN(range.end.getTime())
    );

  if (parsed.length === 0) {
    if (ranges.length > 0) {
      console.warn(
        `[summarization] Object has ${ranges.length} time range(s) but none are valid`,
      );
    }
    return null;
  }

  const start = parsed.reduce(
    (min: Date, cur: any) => (cur.start < min ? cur.start : min),
    parsed[0].start,
  );
  const end = parsed.reduce(
    (max: Date, cur: any) => (cur.end > max ? cur.end : max),
    parsed[0].end,
  );
  return { start, end };
}

async function loadTranscripts(
  jwt: string,
  myceliaUrl: string,
  start: Date,
  end: Date,
) {
  return await callResource<MongoRequest, MongoResponse>("mongo", {
    action: "find",
    collection: "transcriptions",
    query: {
      // Include every transcription that overlaps the conversation range, not
      // only records whose start timestamp falls inside it.
      start: { $lte: end },
      end: { $gte: start },
    },
    options: { sort: { start: 1 } },
  }, { jwt, myceliaUrl });
}

function buildPromptFromTranscripts(transcripts: any[]): string {
  let promptText = "";
  let lastEnd = new Date(transcripts[0].start).getTime();
  promptText += getTimestampMessage(new Date(transcripts[0].start)) + "\n";

  for (const t of transcripts) {
    const tStart = new Date(t.start).getTime();
    const tEnd = new Date(t.end).getTime();
    const gap = tStart - lastEnd;

    if (gap > 30 * 1000) {
      promptText += getTimestampMessage(new Date(lastEnd)) + "\n";
      promptText += getSilenceMessage(gap) + "\n";
      promptText += getTimestampMessage(new Date(tStart)) + "\n";
    }

    const text = t.segments.map((s: any) => s.text).join("").trim();
    if (text) {
      promptText += text + "\n";
    }
    lastEnd = tEnd;
  }
  promptText += getTimestampMessage(new Date(lastEnd));
  return promptText;
}

function createTranscriptSummaryEntry(
  promptText: string,
  jobData: SummarizationJobData,
  jobId: string,
  sourceRefs: SummarySourceRefs,
) {
  return {
    text: promptText.trim(),
    model: "passthrough",
    modelName: "transcript-only",
    date: new Date(),
    prompt: "Short duration - transcript used directly",
    promptName: jobData.promptName,
    jobId,
    sourceRefs,
    provenance: {
      task: "summarization",
      requestedModel: "passthrough",
      resolvedModel: "transcript-only",
      fallbackUsed: false,
    },
  };
}

function createLLMSummaryEntry(
  summary: string,
  completion: any,
  systemPrompt: string,
  jobData: SummarizationJobData,
  jobId: string,
  sourceRefs: SummarySourceRefs,
) {
  const provenance = getInferenceProvenance(
    completion,
    jobData.model || "small",
    resolveWorkerFallbackModel(
      jobData.fallbackModel,
      "SUMMARIZATION_FALLBACK_MODEL",
    ),
  );
  return {
    text: summary,
    model: jobData.model || "small",
    modelName: completion.model,
    requestedModel: provenance.requestedModel,
    resolvedModel: provenance.resolvedModel,
    fallbackModel: provenance.fallbackModel,
    fallbackUsed: provenance.fallbackUsed,
    providerBaseUrl: provenance.providerBaseUrl,
    provenance: {
      task: "summarization",
      ...provenance,
    },
    date: new Date(),
    prompt: systemPrompt,
    promptName: jobData.promptName,
    usage: completion.usage
      ? {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
        // litellm returns cost in response_cost (extracted from x-litellm-response-cost header)
        cost: completion.response_cost,
      }
      : undefined,
    jobId,
    sourceRefs,
  };
}

async function updateObjectSummaries(
  existingObjectId: string,
  summaryEntry: any,
  allowExisting: boolean,
  jwt: string,
  myceliaUrl: string,
): Promise<{ objectId: string; title: string; skipped: boolean }> {
  const currentObject = await callResource<ObjectsRequest, ObjectsResponse>(
    "objects",
    {
      action: "get",
      id: existingObjectId.toString(),
    },
    { jwt, myceliaUrl },
  );

  if (!currentObject) {
    throw new Error(`Object ${existingObjectId} not found`);
  }

  if (!allowExisting && !hasNoSummaries(currentObject)) {
    return {
      objectId: existingObjectId.toString(),
      title: currentObject.name || "Conversation",
      skipped: true,
    };
  }

  const title = currentObject.name || "Conversation";
  const currentSummaries = currentObject.summaries || [];
  const newSummaries = [...currentSummaries, summaryEntry];

  await callResource<ObjectsRequest, ObjectsResponse>("objects", {
    action: "update",
    id: existingObjectId.toString(),
    version: currentObject.version ?? 0,
    field: "summaries",
    value: newSummaries,
  }, { jwt, myceliaUrl });

  return { objectId: existingObjectId.toString(), title, skipped: false };
}

async function createConversationWithSummary(
  title: string,
  summaryEntry: any,
  start: Date,
  end: Date,
  metadata: Record<string, unknown>,
  jwt: string,
  myceliaUrl: string,
): Promise<string> {
  const resultObject = await callResource<ObjectsRequest, ObjectsResponse>(
    "objects",
    {
      action: "create",
      object: {
        isConversation: true,
        name: title,
        summaries: [summaryEntry],
        timeRanges: [{ start, end }],
        metadata,
      },
    },
    { jwt, myceliaUrl },
  );

  return resultObject.insertedId.toString();
}

/**
 * Parse the combined {summary, title} response. Returns null when the model
 * ignored the JSON contract, in which case the caller treats the whole text
 * as the summary and derives a title locally.
 */
export function parseSummaryTitleResponse(
  content: string,
): { summary: string; title: string } | null {
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
    const summary = typeof parsed.summary === "string"
      ? parsed.summary.trim()
      : "";
    const title = typeof parsed.title === "string"
      ? parsed.title.trim().replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 200)
      : "";
    if (!summary || !title) return null;
    return { summary, title };
  } catch {
    return null;
  }
}

function deriveTitleFromPrompt(promptText: string): string {
  const firstLine =
    promptText.split("\n").find((line) =>
      !line.startsWith("[") && line.trim()
    ) || "Brief conversation";
  return firstLine.slice(0, 100).trim();
}

// ============================================================================
// Claim Mechanism (prevents duplicate LLM work in auto mode)
// ============================================================================

const SUMMARIZATION_RETRY_BASE_MS = 15 * 60 * 1000;
const SUMMARIZATION_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

export function getSummarizationRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    SUMMARIZATION_RETRY_BASE_MS * 2 ** (safeAttempt - 1),
    SUMMARIZATION_RETRY_MAX_MS,
  );
}

export function isTerminalSummarizationResponseError(message: string): boolean {
  const isCompletionResponseError = message.includes("LLM_INVALID_RESPONSE") ||
    message.includes("LLM_EMPTY_RESPONSE");
  return isCompletionResponseError &&
    /(content_filter|prohibited_content|safety)/i.test(message);
}

export function isProviderSummarizationResponseError(message: string): boolean {
  return message.includes("LLM_INVALID_RESPONSE") ||
    message.includes("LLM_EMPTY_RESPONSE") ||
    message.includes("Failed to call resource llm") ||
    message.includes("LLM API error");
}

async function setSummarizationFailure(
  objectId: string,
  failure: Record<string, unknown> | null,
  jwt: string,
  myceliaUrl: string,
): Promise<void> {
  try {
    const obj = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "get",
      id: objectId,
    }, { jwt, myceliaUrl }) as any;
    if (!obj) return;
    let value: Record<string, unknown> | null = failure;
    if (failure?.status === "failed") {
      const previousAttempts = Number(obj._summarizationFailure?.attempts) || 0;
      const attempts = previousAttempts + 1;
      const failedAt = new Date();
      value = {
        ...failure,
        attempts,
        failedAt: failedAt.toISOString(),
        retryAfter: new Date(
          failedAt.getTime() + getSummarizationRetryDelayMs(attempts),
        ).toISOString(),
      };
    }
    await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "update",
      id: objectId,
      version: obj.version ?? 0,
      field: "_summarizationFailure",
      value,
    }, { jwt, myceliaUrl });
  } catch (error) {
    console.warn(
      `[summarization] Failed to update failure status for ${objectId}:`,
      error,
    );
  }
}

async function releaseClaim(
  objectId: string,
  jwt: string,
  myceliaUrl: string,
): Promise<void> {
  try {
    const obj = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "get",
      id: objectId,
    }, { jwt, myceliaUrl }) as any;
    if (obj) {
      await callResource<ObjectsRequest, ObjectsResponse>("objects", {
        action: "update",
        id: objectId,
        version: obj.version ?? 0,
        field: "_summarizationClaim",
        value: null,
      }, { jwt, myceliaUrl });
    }
  } catch {
    // Best effort - claim will time out eventually
  }
}

async function summarizeConversationRange(
  job: Job<JobData>,
  jobData: SummarizationJobData,
  start: Date,
  end: Date,
  existingObjectId: string | null | undefined,
  sourceContext: SummarySourceContext,
  jwt: string,
  myceliaUrl: string,
): Promise<JobResult> {
  console.log(
    `[summarization] Job ${job.id}: processing time range ${start.toISOString()} to ${end.toISOString()} (${
      Math.round((end.getTime() - start.getTime()) / 1000 / 60)
    }min)`,
  );
  if (existingObjectId) {
    console.log(
      `[summarization] Job ${job.id}: updating existing object ${existingObjectId}`,
    );
  }
  const jobId = job.id ?? "unknown";

  const transcripts = await loadTranscripts(jwt, myceliaUrl, start, end);
  if (!transcripts || transcripts.length === 0) {
    console.log(`[summarization] Job ${job.id}: NO transcripts found in range`);
    return { success: false, message: "No transcripts found in range" };
  }
  console.log(
    `[summarization] Job ${job.id}: found ${transcripts.length} transcripts`,
  );
  const sourceRefs = buildSummarySourceRefs(
    transcripts,
    start,
    end,
    {
      ...sourceContext,
      conversationId: existingObjectId?.toString() ??
        sourceContext.conversationId,
    },
  );
  const promptText = buildPromptFromTranscripts(transcripts);

  const modelAlias = jobData.model || "small";
  const minDurationForLlm = jobData.minDurationForLlm ?? 10;
  const durationSeconds = (end.getTime() - start.getTime()) / 1000;

  // Short duration optimization: skip LLM for very short periods
  if (durationSeconds < minDurationForLlm) {
    console.log(
      `[summarization] Job ${job.id}: duration ${durationSeconds}s < ${minDurationForLlm}s threshold, using transcript directly`,
    );
    const summaryEntry = createTranscriptSummaryEntry(
      promptText,
      jobData,
      jobId,
      sourceRefs,
    );

    if (existingObjectId) {
      const updateResult = await updateObjectSummaries(
        existingObjectId.toString(),
        summaryEntry,
        jobData.allowExisting,
        jwt,
        myceliaUrl,
      );
      if (updateResult.skipped) {
        return {
          success: true,
          objectId: updateResult.objectId,
          message: "Summaries already present, skipping",
        };
      }

      return {
        success: true,
        objectId: updateResult.objectId,
        title: updateResult.title,
        start: start.toISOString(),
        end: end.toISOString(),
        description: promptText.trim(),
        sourceRefs,
      };
    }

    const title = deriveTitleFromPrompt(promptText);
    const objectId = await createConversationWithSummary(
      title,
      summaryEntry,
      start,
      end,
      {
        source: "summarization_job",
        jobId,
        shortDuration: true,
      },
      jwt,
      myceliaUrl,
    );

    return {
      success: true,
      objectId,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      description: promptText.trim(),
      sourceRefs,
    };
  }

  // Load system prompt with priority: job data (includes default overrides) > schema default
  const defaultPrompt =
    "You are a helpful assistant. Summarize the following conversation transcript. Extract key points, topics discussed, decisions made, and any action items. Be concise but comprehensive.";
  const systemPrompt = jobData.prompt || defaultPrompt;
  const promptSource = jobData.prompt ? "job_data" : "default";

  console.log(
    `[summarization] Job ${job.id}: using system prompt from ${promptSource}`,
  );

  // A new conversation also needs a title. It is produced in the SAME call
  // as the summary (structured {summary, title} response) — a separate title
  // call would re-send tokens and re-run the failover chain for no benefit.
  const wantsTitle = !existingObjectId;
  const combinedSystemPrompt = wantsTitle
    ? `${systemPrompt}\n\nReturn JSON with exactly two fields: "summary" (the summary as described above) and "title" (a short plain-text title for the conversation, no formatting).`
    : systemPrompt;
  const responseFormat = wantsTitle
    ? buildJsonSchemaResponseFormat(
      "summary_with_title",
      z.object({ summary: z.string(), title: z.string() })
        .toJSONSchema() as Record<string, unknown>,
    )
    : undefined;

  console.log(
    `[summarization] Job ${job.id}: calling LLM for summary${
      wantsTitle ? "+title" : ""
    } (prompt ${promptText.length} chars, model=${modelAlias})`,
  );
  const summaryFallbackModel = resolveWorkerFallbackModel(
    jobData.fallbackModel,
    "SUMMARIZATION_FALLBACK_MODEL",
  );
  const completion = await callResource<any, any>("llm", {
    action: "completions",
    model: modelAlias,
    // Omit rather than pass undefined: EJSON turns undefined into null.
    ...(summaryFallbackModel ? { fallbackModel: summaryFallbackModel } : {}),
    ...(jobData.providerProfileId
      ? { provider_profile_id: jobData.providerProfileId }
      : {}),
    session_id: createPromptCacheSessionId("summarization-body", {
      system: combinedSystemPrompt,
      responseFormat: {
        ...getSummaryCompletionOptions(modelAlias),
        ...(responseFormat ?? {}),
      },
    }),
    ...getSummaryCompletionOptions(modelAlias),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    messages: [
      { role: "system", content: combinedSystemPrompt },
      { role: "user", content: promptText },
    ],
  }, { jwt, myceliaUrl });

  const rawContent = getChatCompletionText(completion, {
    requestedModel: modelAlias,
    resolvedModel: completion?.mycelia_routing?.resolvedModel ??
      completion?.model,
    purpose: "conversation summary",
  });
  const combined = wantsTitle ? parseSummaryTitleResponse(rawContent) : null;
  const summary = combined?.summary ?? rawContent;
  const truncatedSummary = summary.length > 200
    ? summary.slice(0, 200) + "..."
    : summary;
  console.log(
    `[summarization] Job ${job.id}: LLM returned summary (${summary.length} chars): "${truncatedSummary}"`,
  );

  const summaryEntry = createLLMSummaryEntry(
    summary,
    completion,
    combinedSystemPrompt,
    jobData,
    jobId,
    sourceRefs,
  );

  if (existingObjectId) {
    const updateResult = await updateObjectSummaries(
      existingObjectId.toString(),
      summaryEntry,
      jobData.allowExisting,
      jwt,
      myceliaUrl,
    );
    if (updateResult.skipped) {
      return {
        success: true,
        objectId: updateResult.objectId,
        message: "Summaries already present, skipping",
      };
    }

    return {
      success: true,
      objectId: updateResult.objectId,
      title: updateResult.title,
      start: start.toISOString(),
      end: end.toISOString(),
      description: summary,
      sourceRefs,
      inference: summaryEntry.provenance,
    };
  }

  // Title comes from the combined call above; a model that ignored the JSON
  // contract falls back to a locally derived title.
  const title = combined?.title ?? deriveTitleFromPrompt(summary);
  (summaryEntry as any).titleProvenance = {
    ...summaryEntry.provenance,
    task: "summary_title",
    ...(combined ? {} : { derived: true }),
  };
  console.log(
    `[summarization] Job ${job.id}: title ${
      combined ? "from combined call" : "derived locally"
    }: "${title}"`,
  );

  const objectId = await createConversationWithSummary(
    title,
    summaryEntry,
    start,
    end,
    {
      source: "summarization_job",
      jobId,
    },
    jwt,
    myceliaUrl,
  );

  return {
    success: true,
    objectId,
    title,
    start: start.toISOString(),
    end: end.toISOString(),
    description: summary,
    sourceRefs,
    inference: summaryEntry.provenance,
  };
}

type SummaryTarget = {
  start: Date;
  end: Date;
  objectId?: string;
  sourceContext: SummarySourceContext;
};

async function resolveTargets(
  jobData: SummarizationJobData,
  jobId: string,
  jwt: string,
  myceliaUrl: string,
): Promise<
  {
    targets: SummaryTarget[];
    failure?: JobResult;
    mode: "manual" | "auto";
    hasMore?: boolean;
  }
> {
  const { start: startStr, end: endStr, objectId: existingObjectId } = jobData;

  if (startStr && endStr) {
    let sourceContext: SummarySourceContext = {};
    if (existingObjectId) {
      const currentObject = await callResource<ObjectsRequest, ObjectsResponse>(
        "objects",
        { action: "get", id: existingObjectId.toString() },
        { jwt, myceliaUrl },
      );
      if (!currentObject) {
        return {
          targets: [],
          failure: {
            success: false,
            objectId: existingObjectId.toString(),
            message: "Object not found",
          },
          mode: "manual",
        };
      }
      sourceContext = getConversationSourceContext(currentObject);
    }
    return {
      targets: [{
        start: new Date(startStr),
        end: new Date(endStr),
        objectId: existingObjectId?.toString(),
        sourceContext,
      }],
      mode: "manual",
    };
  }

  if (existingObjectId) {
    const currentObject = await callResource<ObjectsRequest, ObjectsResponse>(
      "objects",
      {
        action: "get",
        id: existingObjectId.toString(),
      },
      { jwt, myceliaUrl },
    );

    if (!currentObject) {
      return {
        targets: [],
        failure: {
          success: false,
          objectId: existingObjectId.toString(),
          message: "Object not found",
        },
        mode: "manual",
      };
    }

    const range = getConversationRange(currentObject);
    if (!range) {
      return {
        targets: [],
        failure: {
          success: false,
          objectId: existingObjectId.toString(),
          message: "No valid time range for conversation",
        },
        mode: "manual",
      };
    }

    return {
      targets: [{
        start: range.start,
        end: range.end,
        objectId: existingObjectId.toString(),
        sourceContext: getConversationSourceContext(currentObject),
      }],
      mode: "manual",
    };
  }

  const BATCH_LIMIT = jobData.batchSize ?? 25;
  // Fetch extra candidates: concurrent jobs list the same top of the queue
  // (same sort), so without the surplus the whole batch could already be
  // claimed by siblings. x8 covers the maximum worker concurrency the UI
  // allows.
  const FETCH_LIMIT = Math.min(BATCH_LIMIT * 8, 200);
  const claimStaleMs = getJobTimeoutMs(name, jobData);
  const conversations = await callResource<ObjectsRequest, ObjectsResponse>(
    "objects",
    {
      action: "list",
      filters: {
        isConversation: true,
        "summaries.0": { $exists: false },
        // Skip conversations another summarization job is actively working
        // on; stale claims (crashed jobs) stay eligible.
        $and: [{
          $or: [
            { _summarizationClaim: { $exists: false } },
            { _summarizationClaim: null },
            {
              "_summarizationClaim.startedAt": {
                $lte: new Date(Date.now() - claimStaleMs).toISOString(),
              },
            },
          ],
        }],
        $or: [
          { "_summarizationFailure.status": { $ne: "failed" } },
          { "_summarizationFailure.retryAfter": { $exists: false } },
          {
            "_summarizationFailure.retryAfter": {
              $lte: jobData.retryNow
                ? "9999-12-31T23:59:59.999Z"
                : new Date().toISOString(),
            },
          },
        ],
      },
      options: {
        limit: FETCH_LIMIT + 1,
        sort: { updatedAt: -1 },
      },
    },
    { jwt, myceliaUrl },
  ) as any[];

  const hasMore = (conversations || []).length > BATCH_LIMIT;
  const targets = (conversations || []).slice(0, FETCH_LIMIT)
    .map((conversation) => {
      const range = getConversationRange(conversation);
      if (!range) return null;
      return {
        start: range.start,
        end: range.end,
        objectId: conversation._id?.toString(),
        sourceContext: getConversationSourceContext(conversation),
      };
    })
    .filter(Boolean) as SummaryTarget[];

  // Claim the batch upfront in chunks until the quota is met. The bulk
  // claim is atomic per document, so each conversation is won by exactly
  // one concurrent job and batch slots are never burned on claim races.
  const staleBefore = new Date(Date.now() - claimStaleMs).toISOString();
  const claimedTargets: SummaryTarget[] = [];
  let cursor = 0;
  while (claimedTargets.length < BATCH_LIMIT && cursor < targets.length) {
    const chunk = targets.slice(
      cursor,
      cursor + (BATCH_LIMIT - claimedTargets.length),
    );
    cursor += chunk.length;
    const res = await callResource<ObjectsRequest, ObjectsResponse>(
      "objects",
      {
        action: "claimSummarization",
        ids: chunk.map((t) => t.objectId).filter(Boolean) as string[],
        jobId,
        staleBefore,
      },
      { jwt, myceliaUrl },
    ) as { claimed?: string[] };
    const won = new Set(res?.claimed ?? []);
    claimedTargets.push(
      ...chunk.filter((t) => t.objectId && won.has(t.objectId)),
    );
  }
  console.log(
    `[summarization] Job ${jobId}: claimed ${claimedTargets.length}/${BATCH_LIMIT} conversation(s) from a window of ${targets.length}`,
  );

  return { targets: claimedTargets, mode: "auto", hasMore };
}

async function processConversation(
  job: Job<JobData>,
  jobData: SummarizationJobData,
  target: SummaryTarget,
  jwt: string,
  myceliaUrl: string,
): Promise<JobResult> {
  return summarizeConversationRange(
    job,
    jobData,
    target.start,
    target.end,
    target.objectId,
    target.sourceContext,
    jwt,
    myceliaUrl,
  );
}

/** Process the summarization job */
export async function use(job: Job<JobData>): Promise<JobResult> {
  const jobData = job.data as SummarizationJobData;
  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const myceliaUrl = env.MYCELIA_URL;

  const { targets, failure, mode, hasMore } = await resolveTargets(
    jobData,
    job.id ?? "unknown",
    jwt,
    myceliaUrl,
  );
  if (failure) return failure;

  if (mode === "manual") {
    if (targets.length === 0) {
      throw new Error("Summarization has no valid targets");
    }
    let result: JobResult;
    try {
      result = await processConversation(
        job,
        jobData,
        targets[0],
        jwt,
        myceliaUrl,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        targets[0].objectId &&
        isTerminalSummarizationResponseError(message)
      ) {
        await setSummarizationFailure(
          targets[0].objectId,
          {
            status: "failed",
            code: "LLM_CONTENT_FILTERED",
            message: message.slice(0, 1000),
            requestedModel: jobData.model || "small",
            jobId: job.id ?? "unknown",
            failedAt: new Date().toISOString(),
          },
          jwt,
          myceliaUrl,
        );
      }
      throw error;
    }
    if (!result.success) {
      throw new Error(
        String(result.message ?? "Summarization did not produce a result"),
      );
    }
    if (targets[0].objectId) {
      await setSummarizationFailure(
        targets[0].objectId,
        null,
        jwt,
        myceliaUrl,
      );
    }
    return result;
  }

  if (targets.length === 0) {
    console.log(
      `[summarization] Job ${job.id}: NO conversations missing summaries`,
    );
    return {
      success: true,
      processed: 0,
      skipped: 0,
      hasMore: false,
      message: "No conversations missing summaries",
    };
  }

  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];
  const summaries: Array<{
    objectId: string;
    title?: string;
    sourceRefs?: SummarySourceRefs;
  }> = [];
  const inferenceRuns: InferenceProvenance[] = [];
  const skips: string[] = [];
  const jobId = job.id ?? "unknown";
  const batchLimit = jobData.batchSize ?? 25;
  // Targets were claimed upfront in resolveTargets; if this job dies before
  // reaching some of them, release those claims instead of leaving them to
  // expire by staleness.
  const unprocessed = new Set(
    targets.map((t) => t.objectId).filter(Boolean) as string[],
  );
  const releaseRemainingClaims = async () => {
    if (unprocessed.size === 0) return;
    try {
      await callResource<ObjectsRequest, ObjectsResponse>("objects", {
        action: "releaseSummarization",
        ids: [...unprocessed],
        jobId,
      }, { jwt, myceliaUrl });
    } catch (releaseError) {
      console.warn(
        `[summarization] Job ${jobId}: failed to release ${unprocessed.size} claim(s):`,
        releaseError,
      );
    }
  };

  for (const target of targets) {
    if (processed >= batchLimit) break;
    if (target.objectId) unprocessed.delete(target.objectId);

    try {
      const result = await processConversation(
        job,
        jobData,
        target,
        jwt,
        myceliaUrl,
      );
      if (result.success) {
        processed++;
        if (target.objectId) {
          await setSummarizationFailure(
            target.objectId,
            null,
            jwt,
            myceliaUrl,
          );
          await releaseClaim(target.objectId, jwt, myceliaUrl);
        }
        if (
          typeof result.objectId === "string" &&
          typeof result.title === "string"
        ) {
          summaries.push({
            objectId: result.objectId,
            title: result.title,
            sourceRefs: result.sourceRefs as SummarySourceRefs | undefined,
          });
        }
        if (result.inference) {
          inferenceRuns.push(result.inference as InferenceProvenance);
          // Live routing info for the jobs list while the batch is active.
          try {
            await job.updateProgress({
              ...(typeof job.progress === "object" && job.progress !== null
                ? job.progress as Record<string, unknown>
                : {}),
              processed,
              skipped,
              inference: summarizeInferenceUsage(inferenceRuns),
            });
          } catch {
            // Progress updates are best-effort.
          }
        }
      } else {
        if (target.objectId) {
          await releaseClaim(target.objectId, jwt, myceliaUrl);
        }
        skipped++;
        errors.push(
          String(
            result.message ??
              `Conversation ${
                target.objectId ?? "unknown"
              } produced no summary`,
          ),
        );
      }
    } catch (error) {
      console.error(
        `[summarization] Job ${job.id}: failed to summarize conversation ${
          target.objectId ?? "unknown"
        }`,
        error,
      );
      if (target.objectId) {
        await releaseClaim(target.objectId, jwt, myceliaUrl);
      }
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      if (isTerminalSummarizationResponseError(errorMessage)) {
        if (target.objectId) {
          await setSummarizationFailure(
            target.objectId,
            {
              status: "failed",
              code: "LLM_CONTENT_FILTERED",
              message: errorMessage.slice(0, 1000),
              requestedModel: jobData.model || "small",
              jobId,
              failedAt: new Date().toISOString(),
            },
            jwt,
            myceliaUrl,
          );
        }
        skipped++;
        errors.push(errorMessage);
        continue;
      }
      if (isProviderSummarizationResponseError(errorMessage)) {
        await releaseRemainingClaims();
        throw error;
      }
      skipped++;
      errors.push(errorMessage);
    }
  }

  await releaseRemainingClaims();

  if (processed === 0) {
    if (errors.length === 0 && skipped > 0) {
      // Everything raced with another job or was summarized meanwhile —
      // nothing failed, there is simply no work left in this batch.
      return {
        success: true,
        processed,
        skipped,
        skips,
        summaries,
        hasMore: hasMore ?? false,
        message:
          `All ${skipped} candidate(s) were already summarized or claimed by other jobs`,
      };
    }
    const firstError = errors[0] ?? "No conversation could be summarized";
    throw new Error(
      `Summarization processed 0 of ${targets.length} conversation(s); ${skipped} skipped or failed. ${firstError}`,
    );
  }

  const inference = summarizeInferenceUsage(inferenceRuns);
  return {
    success: true,
    processed,
    skipped,
    skips: skips.slice(0, 25),
    summaries,
    hasMore: hasMore ?? false,
    errors: errors.slice(0, 10),
    // Compact routing summary so the jobs list can show the provider and
    // model that actually served this job.
    ...(inference ? { inference } : {}),
  };
}

const capability: JobCapability = {
  name,
  maxConcurrency: 1,
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
    objectId: z.string().optional(),
    title: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    description: z.string().optional(),
    sourceRefs: summarySourceRefsSchema.optional(),
    processed: z.number().optional(),
    skipped: z.number().optional(),
    summaries: z.array(z.object({
      objectId: z.string(),
      title: z.string().optional(),
      sourceRefs: summarySourceRefsSchema.optional(),
    })).optional(),
    hasMore: z.boolean().optional(),
    message: z.string().optional(),
    errors: z.array(z.string()).optional(),
    skips: z.array(z.string()).optional().describe(
      "Benign per-conversation skips (already summarized or claimed).",
    ),
    inference: z.record(z.string(), z.unknown()).optional().describe(
      "Compact LLM routing summary: provider and model that served this job.",
    ),
  })),
  policies: [
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "llm/chat", action: "completions", effect: "allow" },
    { resource: "objects", action: "*", effect: "allow" },
  ],
  use,
  triggers: {
    sources: [
      {
        channel: "mycelia:mongo:objects",
        name: "conversation_missing_summary",
        filter: {
          event: "mongo.change",
          "data.document.isConversation": true,
          "data.document.summaries.0": { $exists: false },
          $or: [
            { "data.operationType": "insert" },
            {
              "data.operationType": "update",
              "data.updateDescription.updatedFields._summarizationClaim": {
                $exists: false,
              },
              "data.updateDescription.removedFields": {
                $nin: ["_summarizationClaim"],
              },
            },
          ],
        },
      },
    ],
    debounceMs: 5000,
    // Revisit historical conversations that were created while this worker or
    // the inference provider was unavailable. TriggerManager only enqueues the
    // check when this worker has no active/waiting job.
    interval: 300,
  },
};

export default capability;
