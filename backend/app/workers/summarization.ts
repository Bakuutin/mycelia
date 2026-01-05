import type { Job } from "bullmq";
import { z } from "zod";
import { ObjectId } from "bson";
import type { JobData, JobResult } from "../types.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getLLMResource } from "@/lib/llm/resource.server.ts";
import { getObjectsResource } from "@/lib/objects/resource.server.ts";
import { zDateOrString } from "@/lib/zod-json-schema.ts";

/** Job type name */
export const name = "summarization";

/** Schema for summarization job data */
export const schema = z.object({
  type: z.literal("summarization"),
  start: zDateOrString(),
  end: zDateOrString(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  objectId: z.string().optional(),
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
  
  const auth = await getServerAuth();

  const mongo = await getMongoResource(auth);
  const transcripts = await mongo({
    action: "find",
    collection: "transcriptions",
    query: {
      start: { $gte: start, $lte: end },
    },
    options: { sort: { start: 1 } },
  });

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

  const llm = await getLLMResource(auth);
  const modelAlias = userModel || "medium";
  const systemPrompt = userPrompt ||
    `You are a helpful assistant. Summarize the following conversation transcript.`;

  const completion = await llm({
    action: "completions",
    model: modelAlias,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptText },
    ],
  });

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

  const objects = await getObjectsResource(auth);

  if (existingObjectId) {
    const currentObject = await objects({
      action: "get",
      id: existingObjectId,
    });

    if (!currentObject) {
      throw new Error(`Object ${existingObjectId} not found`);
    }

    const currentSummaries = currentObject.summaries || [];
    const newSummaries = [...currentSummaries, summaryEntry];

    await objects({
      action: "update",
      id: existingObjectId,
      version: currentObject.version ?? 0,
      field: "summaries",
      value: newSummaries,
    });

    objectId = existingObjectId;
  } else {
    const titleResponse = await llm({
      action: "completions",
      model: modelAlias,
      messages: [
        { role: "system", content: "Generate a short title for this conversation, no formatting" },
        { role: "user", content: summaryEntry.text },
      ],
    });
    const resultObject = await objects({
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
    });
    objectId = resultObject.insertedId.toString();
  }

  return {
    success: true,
    objectId: objectId,
    description: summary,
  };
}
