import { createHash } from "node:crypto";
import { ObjectId } from "bson";
import type { Job } from "bullmq";
import { z } from "zod";
import { callResource } from "@myceliasdk/resources.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { getChatCompletionText } from "@/lib/llm/completion-response.ts";
import { getSummaryCompletionOptions } from "@/lib/llm/completion-options.ts";
import { createPromptCacheSessionId } from "@/lib/llm/prompt-cache-session.ts";
import {
  buildPromptFromTranscripts,
  buildSummarySourceRefs,
  claimConversation,
  createLLMSummaryEntry,
  getConversationRange,
  getConversationSourceContext,
  hasNoSummaries,
  releaseClaim,
  updateObjectSummaries,
  type SummarySourceRefs,
} from "./summarization.ts";

export const OPENROUTER_BATCH_MODEL = "deepseek/deepseek-v4-flash";
const BATCH_LIMIT = 100;
const BATCH_CLAIM_HOLD_MS = 25 * 60 * 60 * 1000;
const ACTIVE_BATCH_STATES = ["validating", "in_progress", "finalizing", "cancelling"];
const TERMINAL_BATCH_STATES = ["completed", "failed", "expired", "cancelled"];
const PROVIDER_CONTROL_ID = "openrouter_batch";

export const schema = z.object({
  type: z.literal("openrouter_batch"),
  action: z.enum(["dry_run", "submit"]).default("dry_run"),
  task: z.literal("summarization").default("summarization"),
  // Keep the production default pinned to DeepSeek, but allow the explicit
  // GPT-4o compatibility probe without changing the normal worker default.
  model: z.enum([OPENROUTER_BATCH_MODEL, "openai/gpt-4o"])
    .default(OPENROUTER_BATCH_MODEL),
  prompt: z.string().min(1).optional().describe(
    "Leave empty to snapshot the currently configured summary prompt",
  ),
  promptName: z.string().optional(),
  limit: z.number().int().min(1).max(BATCH_LIMIT).default(BATCH_LIMIT),
  objectIds: z.array(z.string()).max(BATCH_LIMIT).optional(),
});

const pollSchema = z.object({ type: z.literal("openrouter_batch_poll") });

type OpenRouterBatchJobData = z.infer<typeof schema>;

type BatchItem = {
  customId: string;
  objectId: string;
  sourceRefs: SummarySourceRefs;
  requestHash: string;
};

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function itemId(objectId: string, hash: string): string {
  return `summary:${objectId}:${hash.slice(0, 16)}`;
}

function isProviderWideError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /OpenRouter Batch API error \((?:401|403|404|408|409|429|5\d{2})\)/.test(message)
    || /OpenRouter Batch API returned an invalid JSON response/.test(message);
}

async function findTargets(
  data: OpenRouterBatchJobData,
  objects: (input: any) => Promise<any>,
) {
  if (data.objectIds?.length) {
    return await objects({
      action: "list",
      filters: {
        _id: { $in: data.objectIds.map((id) => new ObjectId(id)) },
        isConversation: true,
      },
      options: { limit: data.limit },
    });
  }
  return await objects({
    action: "list",
    filters: {
      isConversation: true,
      "summaries.0": { $exists: false },
      $or: [
        { "_summarizationFailure.status": { $ne: "failed" } },
        { "_summarizationFailure.retryAfter": { $exists: false } },
        { "_summarizationFailure.retryAfter": { $lte: new Date().toISOString() } },
      ],
    },
    options: { limit: data.limit, sort: { updatedAt: -1 } },
  });
}

async function prepareItems(
  jobId: string,
  data: OpenRouterBatchJobData,
  jwt: string,
  myceliaUrl: string,
): Promise<{ requests: Array<{ custom_id: string; body: Record<string, unknown> }>; items: BatchItem[]; skipped: number }> {
  const mongo = (input: any) => callResource("mongo", input, { jwt, myceliaUrl });
  const objects = (input: any) => callResource("objects", input, { jwt, myceliaUrl });
  const targets = await findTargets(data, objects);
  const requests: Array<{ custom_id: string; body: Record<string, unknown> }> = [];
  const items: BatchItem[] = [];
  let skipped = 0;

  for (const target of targets) {
    if (!hasNoSummaries(target)) {
      skipped++;
      continue;
    }
    const objectId = target._id?.toString();
    const range = getConversationRange(target);
    if (!objectId || !range) {
      skipped++;
      continue;
    }
    const transcripts = await mongo({
      action: "find",
      collection: "transcriptions",
      query: { start: { $lte: range.end }, end: { $gte: range.start } },
      options: { sort: { start: 1 } },
    }) as any[];
    if (!transcripts?.length) {
      skipped++;
      continue;
    }
    const promptText = buildPromptFromTranscripts(transcripts);
    const body: Record<string, unknown> = {
      session_id: createPromptCacheSessionId("summarization-body", {
        system: data.prompt,
        responseFormat: getSummaryCompletionOptions(data.model),
      }),
      ...getSummaryCompletionOptions(data.model),
      messages: [
        { role: "system", content: data.prompt },
        { role: "user", content: promptText },
      ],
    };
    // Include the optimistic object version in the durable identity so a
    // changed conversation cannot be mistaken for an earlier batch request.
    const hash = requestHash({ body, objectVersion: target.version ?? 0 });
    const customId = itemId(objectId, hash);
    if (!await claimConversation(objectId, jobId, jwt, myceliaUrl, {
      kind: "openrouter_batch",
      // 24h provider completion window + a bounded margin for the next poll.
      holdUntil: new Date(Date.now() + BATCH_CLAIM_HOLD_MS),
    })) {
      skipped++;
      continue;
    }
    requests.push({ custom_id: customId, body });
    items.push({
      customId,
      objectId,
      requestHash: hash,
      sourceRefs: buildSummarySourceRefs(
        transcripts,
        range.start,
        range.end,
        getConversationSourceContext(target),
      ),
    });
  }
  return { requests, items, skipped };
}

async function submit(job: Job<JobData>): Promise<JobResult> {
  const data = job.data as OpenRouterBatchJobData;
  if (!data.prompt) {
    throw new Error(
      "OpenRouter batch needs a configured summarization prompt before submission",
    );
  }
  const promptVersion = requestHash({ prompt: data.prompt }).slice(0, 16);
  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const myceliaUrl = Deno.env.get("MYCELIA_URL")!;
  const jobId = job.id ?? "unknown";
  const mongo = (input: any) => callResource("mongo", input, { jwt, myceliaUrl });
  const control = await mongo({
    action: "findOne",
    collection: "openrouter_batch_control",
    query: { _id: PROVIDER_CONTROL_ID },
  }) as Record<string, unknown> | null;
  if (control?.paused) {
    throw new Error(
      `OpenRouter batch submissions are paused after a provider-wide error: ${String(control.reason ?? "unknown error")}`,
    );
  }
  const prepared = await prepareItems(jobId, data, jwt, myceliaUrl);
  await job.updateProgress({ stage: "prepared", processed: 0, total: prepared.items.length });

  if (data.action === "dry_run") {
    await Promise.all(prepared.items.map((item) => releaseClaim(item.objectId, jwt, myceliaUrl)));
    const estimatedInputCharacters = prepared.requests.reduce(
      (sum, request) => sum + JSON.stringify(request.body).length,
      0,
    );
    return {
      success: true,
      dryRun: true,
      model: data.model,
      promptName: data.promptName,
      promptVersion,
      items: prepared.items.length,
      skipped: prepared.skipped,
      estimatedInputTokens: Math.ceil(estimatedInputCharacters / 4),
      preview: prepared.items.slice(0, 10).map((item) => ({ objectId: item.objectId, customId: item.customId })),
    };
  }
  if (!prepared.requests.length) {
    return { success: true, submitted: false, items: 0, skipped: prepared.skipped, message: "No eligible conversations for batch submission" };
  }

  const llm = (input: any) => callResource("llm", input, { jwt, myceliaUrl });
  let submitted: any;
  try {
    submitted = await llm({
      action: "batch_submit",
      endpoint: "/v1/chat/completions",
      model: data.model,
      requests: prepared.requests,
    });
  } catch (error) {
    await Promise.all(prepared.items.map((item) => releaseClaim(item.objectId, jwt, myceliaUrl)));
    if (isProviderWideError(error)) {
      await mongo({
        action: "updateOne",
        collection: "openrouter_batch_control",
        query: { _id: PROVIDER_CONTROL_ID },
        update: {
          $set: {
            paused: true,
            pausedAt: new Date(),
            reason: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          },
        },
        options: { upsert: true },
      });
    }
    throw error;
  }

  if (!submitted?.id) {
    await Promise.all(prepared.items.map((item) => releaseClaim(item.objectId, jwt, myceliaUrl)));
    throw new Error("OpenRouter accepted no batch id");
  }
  await mongo({
    action: "insertOne",
    collection: "openrouter_batches",
    doc: {
      batchId: submitted.id,
      ownerJobId: jobId,
      task: data.task,
      endpoint: "/v1/chat/completions",
      model: data.model,
      prompt: data.prompt,
      promptName: data.promptName,
      promptVersion,
      status: submitted.status ?? "validating",
      requestCounts: submitted.request_counts,
      items: prepared.items,
      submittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await job.updateProgress({ stage: "submitted", processed: 0, total: prepared.items.length, batchId: submitted.id });
  return { success: true, submitted: true, batchId: submitted.id, status: submitted.status, items: prepared.items.length, skipped: prepared.skipped, completionWindow: submitted.completion_window ?? "24h" };
}

async function poll(job: Job<JobData>): Promise<JobResult> {
  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const myceliaUrl = Deno.env.get("MYCELIA_URL")!;
  const mongo = (input: any) => callResource("mongo", input, { jwt, myceliaUrl });
  const llm = (input: any) => callResource("llm", input, { jwt, myceliaUrl });
  const batches = await mongo({
    action: "find",
    collection: "openrouter_batches",
    query: { status: { $in: ACTIVE_BATCH_STATES } },
    options: { sort: { submittedAt: 1 }, limit: 100 },
  }) as Array<Record<string, any>>;
  let imported = 0;
  let failed = 0;
  let checked = 0;

  for (const batch of batches) {
    checked++;
    let batchImported = 0;
    let batchFailed = 0;
    const remote = await llm({ action: "batch_get", batchId: batch.batchId }) as Record<string, any>;
    const update: Record<string, unknown> = {
      status: remote.status,
      requestCounts: remote.request_counts,
      usage: remote.usage,
      updatedAt: new Date(),
      ...(TERMINAL_BATCH_STATES.includes(remote.status) ? { completedAt: new Date() } : {}),
    };
    if (remote.status === "completed" && Array.isArray(remote.results)) {
      const itemsById = new Map<string, BatchItem>(
        (batch.items ?? []).map((item: BatchItem) => [item.customId, item]),
      );
      const itemResults: Array<Record<string, unknown>> = [];
      const seenCustomIds = new Set<string>();
      for (const result of remote.results) {
        const item = itemsById.get(result.custom_id);
        if (!item) continue;
        seenCustomIds.add(item.customId);
        try {
          if (!result.response?.body) throw new Error(result.error?.message ?? "Batch item returned no response body");
          const completion = {
            ...result.response.body,
            mycelia_routing: {
              requestedModel: batch.model,
              resolvedModel: result.response.body.model ?? batch.model,
              fallbackUsed: false,
              providerBaseUrl: "https://openrouter.ai/api/v1",
              promptCaching: { enabled: true },
            },
          };
          const text = getChatCompletionText(completion, {
            requestedModel: batch.model,
            resolvedModel: completion.mycelia_routing.resolvedModel,
            purpose: "batched conversation summary",
          });
          const entry = createLLMSummaryEntry(text, completion, batch.prompt, {
            type: "summarization",
            prompt: batch.prompt,
            promptName: batch.promptName,
            model: batch.model,
            fallbackModel: "",
            allowExisting: false,
            retryNow: false,
            minDurationForLlm: 10,
          }, batch.ownerJobId, item.sourceRefs);
          const saved = await updateObjectSummaries(item.objectId, entry, false, jwt, myceliaUrl);
          await releaseClaim(item.objectId, jwt, myceliaUrl);
          if (!saved.skipped) {
            imported++;
            batchImported++;
          }
          itemResults.push({ customId: item.customId, objectId: item.objectId, status: saved.skipped ? "skipped" : "imported" });
        } catch (error) {
          failed++;
          batchFailed++;
          await releaseClaim(item.objectId, jwt, myceliaUrl);
          itemResults.push({ customId: item.customId, objectId: item.objectId, status: "failed", error: error instanceof Error ? error.message.slice(0, 1000) : String(error) });
        }
      }
      for (const item of itemsById.values()) {
        if (seenCustomIds.has(item.customId)) continue;
        failed++;
        batchFailed++;
        await releaseClaim(item.objectId, jwt, myceliaUrl);
        itemResults.push({ customId: item.customId, objectId: item.objectId, status: "failed", error: "Batch completed without an item result" });
      }
      update.importedAt = new Date();
      update.itemResults = itemResults;
      update.importCounts = { imported: batchImported, failed: batchFailed };
    } else if (TERMINAL_BATCH_STATES.includes(remote.status)) {
      await Promise.all((batch.items ?? []).map((item: BatchItem) => releaseClaim(item.objectId, jwt, myceliaUrl)));
    }
    await mongo({ action: "updateOne", collection: "openrouter_batches", query: { _id: batch._id }, update: { $set: update } });
    await job.updateProgress({ stage: "polling", processed: checked, total: batches.length, imported, failed });
  }
  return { success: true, checked, imported, failed, processed: checked };
}

const submitCapability: JobCapability = {
  name: "openrouter_batch",
  maxConcurrency: 1,
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({ success: z.boolean(), batchId: z.string().optional(), items: z.number().optional(), dryRun: z.boolean().optional() })),
  policies: [
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "db/openrouter_batches", action: "*", effect: "allow" },
    { resource: "db/openrouter_batch_control", action: "*", effect: "allow" },
    { resource: "llm/chat", action: "batch_submit", effect: "allow" },
    { resource: "objects", action: "*", effect: "allow" },
  ],
  use: submit,
};

export const pollCapability: JobCapability = {
  name: "openrouter_batch_poll",
  maxConcurrency: 1,
  inputSchema: z.toJSONSchema(pollSchema),
  outputSchema: z.toJSONSchema(z.object({ success: z.boolean(), checked: z.number(), imported: z.number(), failed: z.number(), processed: z.number() })),
  policies: [
    { resource: "db/openrouter_batches", action: "*", effect: "allow" },
    { resource: "llm/chat", action: "batch_get", effect: "allow" },
    { resource: "objects", action: "*", effect: "allow" },
  ],
  use: poll,
  triggers: { sources: [], interval: 300 },
};

export default submitCapability;
