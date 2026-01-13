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

/** Process the summarization job */
export async function use(job: Job<JobData>): Promise<JobResult> {
  const jobData = job.data as SummarizationJobData;

  const { start: startStr, end: endStr, prompt: userPrompt, model: userModel, objectId: existingObjectId } = jobData;
  const start = new Date(startStr);
  const end = new Date(endStr);
  
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
    return { success: false, message: "No transcripts found in range" };
  }

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

  const modelAlias = userModel || "medium";
  const systemPrompt = userPrompt ||
    `You are a helpful assistant. Summarize the following conversation transcript.`;

  const completion = await callResource<any, any>("llm", {
    action: "completions",
    model: modelAlias,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptText },
    ],
  }, { jwt, myceliaUrl });

  const summary: string = completion.choices[0].message.content;

  const summaryEntry = {
    text: summary,
    model: modelAlias,
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

  if (existingObjectId) {
    const currentObject = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "get",
      id: existingObjectId.toString(),
    }, { jwt, myceliaUrl });

    if (!currentObject) {
      throw new Error(`Object ${existingObjectId} not found`);
    }

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
    const titleResponse = await callResource<any, any>("llm", {
      action: "completions",
      model: modelAlias,
      messages: [
        { role: "system", content: "Generate a short title for this conversation, no formatting" },
        { role: "user", content: summaryEntry.text },
      ],
    }, { jwt, myceliaUrl });

    const resultObject = await callResource<ObjectsRequest, ObjectsResponse>("objects", {
      action: "create",
      object: {
        isConversation: true,
        name: titleResponse.choices[0].message.content,
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
    description: summary,
  };
}

const capability: JobCapability = {
  name,
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
    objectId: z.string(),
    description: z.string(),
  })),
  policies: [
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "llm/chat", action: "completions", effect: "allow" },
    { resource: "objects", action: "read", effect: "allow" },
    { resource: "objects", action: "create", effect: "allow" },
    { resource: "objects", action: "update", effect: "allow" },
  ],
  use,
};

export default capability;
