import type { Job } from "bullmq";
import { z } from "zod";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString, zObjectId } from "@myceliasdk/zod-json-schema.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { MongoRequest, MongoResponse } from "@/lib/mongo/core.server.ts";
import type { ObjectsRequest, ObjectsResponse } from "@/lib/objects/resource.server.ts";

/** Job type name */
export const name = "summarization";

/** Schema for summarization job data */
export const schema = z.object({
  type: z.literal("summarization"),
  start: zDateOrString(),
  end: zDateOrString(),
  prompt: z.string()
    .default("You are a helpful assistant. Summarize the following conversation transcript. Extract key points, topics discussed, decisions made, and any action items. Be concise but comprehensive.")
    .describe("System prompt for the summarization. This guides how the AI analyzes the conversation."),
  promptName: z.string().optional()
    .describe("Name of the prompt template used (for display in UI)"),
  model: z.string()
    .default("small")
    .describe("LLM model alias to use for summarization (e.g., 'small', 'large', 'gpt-4o')"),
  objectId: zObjectId().nullish(),
  minDurationForLlm: z.number()
    .default(10)
    .describe("Minimum duration in seconds to use LLM. Shorter periods use transcript directly."),
});

export type SummarizationJobData = z.infer<typeof schema>;

function getTimestampMessage(date: Date): string {
  return `[${date.toISOString()}]`;
}

function getSilenceMessage(gapMs: number): string {
  const duration = Math.round(gapMs / 1000 / 60);
  return `[Silence ${duration}m]`;
}


/** Process the summarization job */
export async function use(job: Job<JobData>): Promise<JobResult> {
  const jobData = job.data as SummarizationJobData;

  const { start: startStr, end: endStr, objectId: existingObjectId } = jobData;
  const start = new Date(startStr);
  const end = new Date(endStr);

  console.log(`[summarization] Job ${job.id}: processing time range ${start.toISOString()} to ${end.toISOString()} (${Math.round((end.getTime() - start.getTime()) / 1000 / 60)}min)`);
  if (existingObjectId) {
    console.log(`[summarization] Job ${job.id}: updating existing object ${existingObjectId}`);
  }

  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const myceliaUrl = env.MYCELIA_URL;

  const transcripts = await callResource<MongoRequest, MongoResponse>("mongo", {
    action: "find",
    collection: "transcriptions",
    query: {
      start: { $gte: start, $lte: end },
    },
    options: { sort: { start: 1 } },
  }, { jwt, myceliaUrl });

  if (!transcripts || transcripts.length === 0) {
    console.log(`[summarization] Job ${job.id}: NO transcripts found in range`);
    return { success: false, message: "No transcripts found in range" };
  }
  console.log(`[summarization] Job ${job.id}: found ${transcripts.length} transcripts`);

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

  const modelAlias = jobData.model || "small";
  const minDurationForLlm = jobData.minDurationForLlm ?? 10;
  const durationSeconds = (end.getTime() - start.getTime()) / 1000;

  // Short duration optimization: skip LLM for very short periods
  if (durationSeconds < minDurationForLlm) {
    console.log(`[summarization] Job ${job.id}: duration ${durationSeconds}s < ${minDurationForLlm}s threshold, using transcript directly`);

    const summaryEntry = {
      text: promptText.trim(),
      model: "passthrough",
      modelName: "transcript-only",
      date: new Date(),
      prompt: "Short duration - transcript used directly",
      promptName: jobData.promptName,
      jobId: job.id,
    };

    let objectId: string;
    let title: string;

    if (existingObjectId) {
      const currentObject = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
        action: "get",
        id: existingObjectId.toString(),
      }, { jwt, myceliaUrl });

      if (!currentObject) {
        throw new Error(`Object ${existingObjectId} not found`);
      }

      title = currentObject.name || "Conversation";
      const currentSummaries = currentObject.summaries || [];
      const newSummaries = [...currentSummaries, summaryEntry];

      await callResource<ObjectsRequest, ObjectsResponse>("objects", {
        action: "update",
        id: existingObjectId.toString(),
        version: currentObject.version ?? 0,
        field: "summaries",
        value: newSummaries,
      }, { jwt, myceliaUrl });

      objectId = existingObjectId.toString();
    } else {
      // For new objects with short duration, use first line as title or generic
      const firstLine = promptText.split('\n').find(line => !line.startsWith('[') && line.trim()) || "Brief conversation";
      title = firstLine.slice(0, 100).trim();

      const resultObject = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
        action: "create",
        object: {
          isConversation: true,
          name: title,
          summaries: [summaryEntry],
          timeRanges: [{ start, end }],
          metadata: {
            source: "summarization_job",
            jobId: job.id,
            shortDuration: true,
          },
        },
      }, { jwt, myceliaUrl });
      objectId = resultObject.insertedId.toString();
    }

    return {
      success: true,
      objectId,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      description: promptText.trim(),
    };
  }

  // Load system prompt with priority: job data (includes default overrides) > schema default
  const defaultPrompt = "You are a helpful assistant. Summarize the following conversation transcript. Extract key points, topics discussed, decisions made, and any action items. Be concise but comprehensive.";
  const systemPrompt = jobData.prompt || defaultPrompt;
  const promptSource = jobData.prompt ? "job_data" : "default";

  console.log(`[summarization] Job ${job.id}: using system prompt from ${promptSource}`);

  console.log(`[summarization] Job ${job.id}: calling LLM for summary (prompt ${promptText.length} chars, model=${modelAlias})`);
  const completion = await callResource<any, any>("llm", {
    action: "completions",
    model: modelAlias,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptText },
    ],
  }, { jwt, myceliaUrl });

  const summary: string = completion.choices[0].message.content;
  const truncatedSummary = summary.length > 200 ? summary.slice(0, 200) + '...' : summary;
  console.log(`[summarization] Job ${job.id}: LLM returned summary (${summary.length} chars): "${truncatedSummary}"`);

  const summaryEntry = {
    text: summary,
    model: modelAlias,
    modelName: completion.model,
    date: new Date(),
    prompt: systemPrompt,
    promptName: jobData.promptName,
    usage: completion.usage ? {
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens,
      totalTokens: completion.usage.total_tokens,
      // litellm returns cost in response_cost (extracted from x-litellm-response-cost header)
      cost: completion.response_cost,
    } : undefined,
    jobId: job.id,
  };

  let objectId;
  let title: string;

  if (existingObjectId) {
    const currentObject = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "get",
      id: existingObjectId.toString(),
    }, { jwt, myceliaUrl });

    if (!currentObject) {
      throw new Error(`Object ${existingObjectId} not found`);
    }

    title = currentObject.name || "Conversation";
    const currentSummaries = currentObject.summaries || [];
    const newSummaries = [...currentSummaries, summaryEntry];

    await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "update",
      id: existingObjectId.toString(),
      version: currentObject.version ?? 0,
      field: "summaries",
      value: newSummaries,
    }, { jwt, myceliaUrl });

    objectId = existingObjectId.toString();
  } else {
    console.log(`[summarization] Job ${job.id}: calling LLM for title generation`);
    const titleResponse = await callResource<any, any>("llm", {
      action: "completions",
      model: modelAlias,
      messages: [
        { role: "system", content: "Generate a short title for this conversation, no formatting" },
        { role: "user", content: summaryEntry.text },
      ],
    }, { jwt, myceliaUrl });

    title = titleResponse.choices[0].message.content;
    console.log(`[summarization] Job ${job.id}: LLM generated title: "${title}"`);

    const resultObject = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "create",
      object: {
        isConversation: true,
        name: title,
        summaries: [summaryEntry],
        timeRanges: [{
          start: start,
          end: end,
        }],
        metadata: {
          source: "summarization_job",
          jobId: job.id,
        },
      },
    }, { jwt, myceliaUrl });
    objectId = resultObject.insertedId.toString();
  }

  return {
    success: true,
    objectId: objectId,
    title: title,
    start: start.toISOString(),
    end: end.toISOString(),
    description: summary,
  };
}

const capability: JobCapability = {
  name,
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
    objectId: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    description: z.string(),
  })),
  policies: [
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "llm/chat", action: "completions", effect: "allow" },
    { resource: "objects", action: "*", effect: "allow" },
  ],
  use,
};

export default capability;
