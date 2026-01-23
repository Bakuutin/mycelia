import type { Job } from "bullmq";
import { z } from "zod";
import { ObjectId } from "mongodb";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString, zObjectId } from "@myceliasdk/zod-json-schema.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { MongoRequest, MongoResponse } from "@/lib/mongo/core.server.ts";
import type { ObjectsRequest, ObjectsResponse } from "@/lib/objects/resource.server.ts";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

/** Job type name */
export const name = "summarization";

/** Schema for summarization job data */
export const schema = z.object({
  type: z.literal("summarization"),
  start: zDateOrString(),
  end: zDateOrString(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  objectId: zObjectId().nullish(),
});

export type SummarizationJobData = z.infer<typeof schema>;

function getTimestampMessage(date: Date): string {
  return `[${date.toISOString()}]`;
}

function getSilenceMessage(gapMs: number): string {
  const duration = Math.round(gapMs / 1000 / 60);
  return `[Silence ${duration}m]`;
}

async function getSystemPromptFromConfig(jwt: string, myceliaUrl: string): Promise<string | null> {
  try {
    // Load server config
    const config = await callResource<MongoRequest, MongoResponse>("mongo", {
      action: "findOne",
      collection: "configs",
      query: { _id: SERVER_CONFIG_ID },
    }, { jwt, myceliaUrl });

    if (!config?.prompts?.summarization_system) {
      return null;
    }

    // Load the prompt document
    const promptId = config.prompts.summarization_system;
    const prompt = await callResource<MongoRequest, MongoResponse>("mongo", {
      action: "findOne",
      collection: "prompts",
      query: { _id: promptId },
    }, { jwt, myceliaUrl });

    return prompt?.text || null;
  } catch (err) {
    console.warn(`[summarization] Failed to load system prompt from config:`, err);
    return null;
  }
}

/** Process the summarization job */
export async function use(job: Job<JobData>): Promise<JobResult> {
  const jobData = job.data as SummarizationJobData;

  const { start: startStr, end: endStr, prompt: userPrompt, model: userModel, objectId: existingObjectId } = jobData;
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

  const modelAlias = userModel || "small";

  // Load system prompt: user override > config setting > fallback
  let systemPrompt = userPrompt;
  if (!systemPrompt) {
    const configPrompt = await getSystemPromptFromConfig(jwt, myceliaUrl);
    systemPrompt = configPrompt || `You are a helpful assistant. Summarize the following conversation transcript.`;
    if (configPrompt) {
      console.log(`[summarization] Job ${job.id}: using system prompt from config`);
    } else {
      console.log(`[summarization] Job ${job.id}: using fallback system prompt (no config found)`);
    }
  }

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
    usage: completion.usage ? {
      promptTokens: completion.usage.prompt_tokens,
      completionTokens: completion.usage.completion_tokens,
      totalTokens: completion.usage.total_tokens,
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

    objectId = existingObjectId;
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
    { resource: "db/configs", action: "read", effect: "allow" },
    { resource: "db/prompts", action: "read", effect: "allow" },
    { resource: "llm/chat", action: "completions", effect: "allow" },
    { resource: "objects", action: "*", effect: "allow" },
  ],
  use,
};

export default capability;
