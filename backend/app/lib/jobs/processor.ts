import type { Job } from "bullmq";
import { ObjectId } from "bson";
import type { JobData, JobResult } from "./types.ts";
import { getServerAuth } from "../auth/core.server.ts";
import { updateAllHistogram } from "../../services/timeline.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getLLMResource } from "@/lib/llm/resource.server.ts";
import { getObjectsResource } from "@/lib/objects/resource.server.ts";

// Helper to format timestamps for prompt
function getTimestampMessage(date: Date): string {
  return `[${date.toISOString()}]`;
}

function getSilenceMessage(gapMs: number): string {
  const duration = Math.round(gapMs / 1000 / 60);
  return `[Silence ${duration}m]`;
}

async function processSummarizationJob(
  job: Job<JobData>,
): Promise<JobResult> {
  const jobData = job.data;
  if (jobData.type !== "summarization") throw new Error("Invalid job type");

  // Destructure from narrowed type
  const { start: startStr, end: endStr, prompt: userPrompt, model: userModel, objectId: existingObjectId } = jobData;
  const start = new Date(startStr);
  const end = new Date(endStr);
  
  const auth = await getServerAuth();

  // 1. Fetch transcripts
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

  // 2. Format transcripts into prompt (similar to python/convos/prompts.py)
  let promptText = "";
  let lastEnd = new Date(transcripts[0].start).getTime();
  promptText += getTimestampMessage(new Date(transcripts[0].start)) + "\n";

  for (const t of transcripts) {
    const tStart = new Date(t.start).getTime();
    const tEnd = new Date(t.end).getTime();
    const gap = tStart - lastEnd;

    // 30 seconds gap threshold
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

  // 3. Call LLM
  const llm = await getLLMResource(auth);
  const systemPrompt = userPrompt ||
    `You are a helpful assistant. Summarize the following conversation transcript.
    Return a JSON object with the following fields:
    - summary: A concise summary of the conversation
    - title: A short title for the conversation
    - emoji: A single emoji representing the conversation
    - entities: A list of people, places, or things mentioned
    - agreed_upon_something: Boolean, whether a decision was made
    `;

    const completion = await llm({
      action: "completions",
      model: userModel || "medium", // Default to a capable model, or make configurable
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: promptText },
      ],
    });
  

  const summary: string = completion.choices[0].message.content;

  // 4. Create or Update Object
  let result;

  if (existingObjectId) {
    await mongo({
        action: "updateOne",
        collection: "objects",
        query: { _id: new ObjectId(existingObjectId) },
        update: {
            $set: {
                details: summary,
                updatedAt: new Date(),
            },
            $inc: { version: 1 }
        }
    });
    result = { insertedId: existingObjectId };
  } else {
    // Create new object
    const objects = await getObjectsResource(auth);
    result = await objects({
      action: "create",
      object: {
        isConversation: true,
        name: summary.slice(0, 100) || "Summarized Conversation",
        details: summary,
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
  }

  return {
    success: true,
    objectId: result.insertedId,
    description: summary,
  };
}

export async function processJob(job: Job<JobData>): Promise<JobResult> {
  const jobType = job.data.type;

  // TypeScript-only jobs
  if (jobType === "histRecalculation") {
    const auth = await getServerAuth();
    // BullMQ deserializes dates as strings
    const start = job.data.start ? new Date(job.data.start) : undefined;
    const end = job.data.end ? new Date(job.data.end) : undefined;

    await updateAllHistogram(
      auth,
      job.data.all ? undefined : start,
      job.data.all ? undefined : end,
    );

    return {
      success: true,
      message: "Pipeline recalculation completed",
    };
  }

  if (jobType === "summarization") {
    return processSummarizationJob(job);
  }

  // Python worker jobs
  const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") ||
    "http://localhost:8000";

  const url = `${PYTHON_WORKER_URL}/jobs/${jobType}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId: job.id,
      data: job.data,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Python worker failed (${response.status}): ${errorText}`,
    );
  }

  const result = await response.json();
  return result;
}
