import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zObjectId, zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { createHash } from "node:crypto";

// ============================================================================
// Types
// ============================================================================

interface Utterance {
  start: Date;
  end: Date;
  text: string;
}

interface Segment {
  title: string;
  start: Date;
  end: Date;
}

interface ConversationMetadata {
  agreed_upon_something: boolean;
  entities: string[];
  emoji: string | undefined;
}

interface ConversationChunk {
  _id: ObjectId;
  chunkKey: string;
  start: Date;
  end: Date;
  transcriptionIds: ObjectId[];
  totalTextLength: number;
  state: string;
  params: {
    model: string;
    force: boolean;
  };
}

// ============================================================================
// Schema
// ============================================================================

export const schema = z.object({
  type: z.literal("conversation_extractor"),
  chunkId: zObjectId().optional(),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  limit: z.number().default(1),
  extractorVersion: z.string().default("v1"),
});

export type ConversationExtractorJobData = z.infer<typeof schema>;

// Server config ID for prompts
const SERVER_CONFIG_ID = "000000000000000000000000";

// ============================================================================
// Pure Functions
// ============================================================================

function formatChunkAsPrompt(utterances: Utterance[]): { prompt: string; start: Date; end: Date } {
  if (utterances.length === 0) {
    throw new Error("Cannot format empty utterances array");
  }

  const sorted = [...utterances].sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  const strings: string[] = [];
  let latest = new Date(sorted[0].start);
  
  strings.push(`[time: ${new Date(sorted[0].start).toISOString()}]`);

  for (const u of sorted) {
    const uStart = new Date(u.start);
    const gap = uStart.getTime() - latest.getTime();
    
    if (gap > 30 * 1000) {  // > 30 seconds
      strings.push(`[time: ${latest.toISOString()}]`);
      const minutes = Math.floor(gap / 1000 / 60);
      const seconds = Math.floor((gap / 1000) % 60);
      strings.push(`[silence ${minutes}m ${seconds}s]`);
      strings.push(`[time: ${uStart.toISOString()}]`);
    }

    strings.push(u.text);
    latest = new Date(Math.max(latest.getTime(), new Date(u.end).getTime()));
  }

  strings.push(`[time: ${latest.toISOString()}]`);

  return {
    prompt: strings.join("\n"),
    start: new Date(sorted[0].start),
    end: latest,
  };
}

function clipSegmentTimes(segment: Segment, chunkStart: Date, chunkEnd: Date): Segment {
  return {
    title: segment.title,
    start: new Date(Math.max(new Date(segment.start).getTime(), chunkStart.getTime())),
    end: new Date(Math.min(new Date(segment.end).getTime(), chunkEnd.getTime())),
  };
}

function filterSegmentsWithUtterances(
  segments: Segment[],
  utterances: Utterance[],
): Array<{ segment: Segment; utterances: Utterance[] }> {
  const result: Array<{ segment: Segment; utterances: Utterance[] }> = [];

  for (const segment of segments) {
    const segStart = new Date(segment.start).getTime();
    const segEnd = new Date(segment.end).getTime();
    
    const overlapping = utterances.filter(u => {
      const uStart = new Date(u.start).getTime();
      const uEnd = new Date(u.end).getTime();
      return uStart < segEnd && uEnd > segStart;
    });

    if (overlapping.length > 0) {
      result.push({ segment, utterances: overlapping });
    }
  }

  return result;
}

function generateExtractionKey(
  chunkId: string,
  promptVersion: string,
  model: string,
  extractorVersion: string,
): string {
  const input = `${chunkId}:${promptVersion}:${model}:${extractorVersion}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ============================================================================
// LLM Operations
// ============================================================================

async function getPrompts(
  mongo: (input: any) => Promise<any>,
): Promise<Record<string, string>> {
  const config = await mongo({
    action: "findOne",
    collection: "configs",
    query: { _id: new ObjectId(SERVER_CONFIG_ID) },
  }) as { prompts?: Record<string, ObjectId> } | null;

  if (!config?.prompts) {
    throw new Error("Server configuration not found or missing prompts mapping");
  }

  const promptIds = Object.values(config.prompts) as ObjectId[];
  
  const prompts = await mongo({
    action: "find",
    collection: "prompts",
    query: { _id: { $in: promptIds } },
  }) as Array<{ _id: ObjectId; text: string }>;

  const promptsMap = new Map(prompts.map((p) => [p._id.toString(), p.text]));

  const result: Record<string, string> = {};
  for (const [key, promptId] of Object.entries(config.prompts)) {
    const text = promptsMap.get((promptId as ObjectId).toString());
    if (text) {
      result[key] = text;
    }
  }

  return result;
}

async function callLLMStructured<T>(
  llm: (input: any) => Promise<any>,
  model: string,
  messages: Array<{ role: string; content: string }>,
  parseResponse: (content: string) => T,
): Promise<T> {
  const response = await llm({
    action: "completions",
    model,
    messages,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from LLM");
  }

  try {
    return parseResponse(content);
  } catch (error) {
    // Retry once with a fix prompt
    const retryResponse = await llm({
      action: "completions",
      model,
      messages: [
        { role: "user", content: `Fix this JSON to be valid:\n${content}` },
      ],
      response_format: { type: "json_object" },
    });

    const retryContent = retryResponse.choices[0]?.message?.content;
    if (!retryContent) {
      throw new Error("Empty retry response from LLM");
    }

    return parseResponse(retryContent);
  }
}

function stripMarkdownCodeBlock(content: string): string {
  let cleaned = content.trim();
  // Remove ```json or ``` at the start
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  // Remove trailing ```
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * Robustly extract and parse JSON from LLM response that may contain extra text.
 * Handles cases where LLM adds explanatory text before or after the JSON.
 */
function extractJsonFromText(content: string): any {
  const cleaned = stripMarkdownCodeBlock(content);
  
  // First, try to parse as-is (for clean JSON responses)
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Continue to more robust extraction
  }
  
  // Try to find JSON object {} or array []
  // Look for the first { or [ and find its matching closing bracket
  const jsonStart = Math.min(
    cleaned.indexOf('{') >= 0 ? cleaned.indexOf('{') : Infinity,
    cleaned.indexOf('[') >= 0 ? cleaned.indexOf('[') : Infinity
  );
  
  if (jsonStart === Infinity) {
    throw new Error("No JSON object or array found in response");
  }
  
  // Find the matching closing bracket
  const startChar = cleaned[jsonStart];
  const endChar = startChar === '{' ? '}' : ']';
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
    
    if (char === '\\') {
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
    throw new Error("Could not find complete JSON object/array in response");
  }
  
  const jsonStr = cleaned.substring(jsonStart, jsonEnd);
  return JSON.parse(jsonStr);
}

function parseSegmentationResponse(content: string): Segment[] {
  const parsed = extractJsonFromText(content);
  const segments = parsed.segments || [];
  return segments.map((s: any, index: number) => {
    // Handle null, undefined, non-string, or empty string titles
    let title = `Segment ${index + 1}`;
    if (s.title != null && typeof s.title === 'string') {
      const trimmed = s.title.trim();
      if (trimmed.length > 0) {
        title = trimmed;
      }
    }
    return {
      title,
      start: new Date(s.start),
      end: new Date(s.end),
    };
  });
}

function parseMetadataResponse(content: string): ConversationMetadata {
  const parsed = extractJsonFromText(content);
  // Only set emoji if valid, otherwise leave undefined (no icon)
  let emoji: string | undefined = undefined;
  if (parsed.emoji != null && typeof parsed.emoji === 'string') {
    const trimmed = parsed.emoji.trim();
    if (trimmed.length > 0) {
      emoji = trimmed;
    }
  }
  return {
    agreed_upon_something: Boolean(parsed.agreed_upon_something),
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    emoji,
  };
}

// ============================================================================
// Entity Operations
// ============================================================================

const entityCache = new Map<string, ObjectId>();

async function findOrCreateEntity(
  objects: (input: any) => Promise<any>,
  name: string,
): Promise<ObjectId> {
  // Check cache first
  const cached = entityCache.get(name);
  if (cached) return cached;

  // Check DB
  const existing = await objects({
    action: "list",
    filters: { name },
    options: { limit: 1 },
  });

  if (existing && existing.length > 0) {
    const id = existing[0]._id;
    entityCache.set(name, id);
    return id;
  }

  // Create new
  const result = await objects({
    action: "create",
    object: { name },
  });

  entityCache.set(name, result.insertedId);
  return result.insertedId;
}

// ============================================================================
// Idempotency Operations
// ============================================================================

async function deleteConversationsInRange(
  objects: (input: any) => Promise<any>,
  mongo: (input: any) => Promise<any>,
  start: Date,
  end: Date,
): Promise<number> {
  // Find conversations in range
  const conversations = await objects({
    action: "list",
    filters: {
      isConversation: true,
      timeRanges: {
        $elemMatch: {
          start: { $lt: end },
          end: { $gt: start },
        },
      },
    },
  });

  if (!conversations || conversations.length === 0) return 0;

  const conversationIds = conversations.map((c: any) => c._id);

  // Delete relationships first
  const relationships = await objects({
    action: "list",
    filters: {
      isRelationship: true,
      "relationship.subject": { $in: conversationIds },
    },
  });

  for (const rel of relationships || []) {
    await objects({
      action: "delete",
      id: rel._id.toString(),
    });
  }

  // Delete conversations
  for (const conv of conversations) {
    await objects({
      action: "delete",
      id: conv._id.toString(),
    });
  }

  return conversations.length;
}

// ============================================================================
// Main Worker
// ============================================================================

const capability: JobCapability = {
  name: "conversation_extractor",
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("completed"),
    success: z.boolean(),
    conversationsCreated: z.number(),
    chunksProcessed: z.number(),
    hasMore: z.boolean(),
    errors: z.array(z.object({
      type: z.string(),
      message: z.string(),
      conversationId: z.string().optional(),
      entity: z.string().optional(),
    })).optional(),
  })),
  policies: [
    { resource: "db/conversation_chunks", action: "read", effect: "allow" },
    { resource: "db/conversation_chunks", action: "update", effect: "allow" },
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
    { resource: "db/prompts", action: "read", effect: "allow" },
    { resource: "objects", action: "*", effect: "allow" },
    { resource: "llm/chat", action: "completions", effect: "allow" },
    { resource: "jobs/summarization", action: "enqueue", effect: "allow" },
  ],
  maxConcurrency: 1,
  use: async (job) => {
    const data = job.data as ConversationExtractorJobData;
    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = Deno.env.get("MYCELIA_URL")!;
    
    const mongo = (input: any) => callResource("mongo", input, { jwt, myceliaUrl });
    const objects = (input: any) => callResource("objects", input, { jwt, myceliaUrl });
    const llm = (input: any) => callResource("llm", input, { jwt, myceliaUrl });
    const jobs = (input: any) => callResource("jobs", input, { jwt, myceliaUrl });

    // Processing timeout (10 minutes)
    const processingTimeoutMs = 10 * 60 * 1000;

    // Find chunks to process
    let chunks: ConversationChunk[];
    
    if (data.chunkId) {
      const chunk = await mongo({
        action: "findOne",
        collection: "conversation_chunks",
        query: { _id: new ObjectId(data.chunkId) },
      }) as ConversationChunk | null;
      chunks = chunk ? [chunk] : [];
    } else {
      // Build query with optional date range filters
      const stateFilter = {
        $or: [
          { state: "ready" },
          {
            state: { $in: ["processing", "error"] },
            processingStartedAt: { $lt: new Date(Date.now() - processingTimeoutMs) },
          },
        ],
      };

      const dateFilter: Record<string, any> = {};
      if (data.start) dateFilter.$gte = new Date(data.start);
      if (data.end) dateFilter.$lt = new Date(data.end);

      const query: Record<string, any> = { ...stateFilter };
      if (Object.keys(dateFilter).length > 0) {
        query.start = dateFilter;
      }

      // Find ready chunks, or stuck processing chunks
      chunks = await mongo({
        action: "find",
        collection: "conversation_chunks",
        query,
        options: {
          sort: { start: -1 },
          limit: data.limit + 1,  // +1 to check if there's more
        },
      }) as ConversationChunk[];
    }

    const hasMore = chunks.length > data.limit;
    const chunksToProcess = chunks.slice(0, data.limit);

    let conversationsCreated = 0;
    let chunksProcessed = 0;
    const errors: Array<{ type: string; message: string; conversationId?: string; entity?: string }> = [];

    // Load prompts
    let prompts: Record<string, string>;
    try {
      prompts = await getPrompts(mongo);
    } catch (error) {
      console.error("Failed to load prompts:", error);
      // Use default prompts
      prompts = {
        segmentation_system: "You are an assistant that segments transcripts into distinct conversations. Output JSON with 'segments' array containing objects with 'title', 'start' (ISO8601), and 'end' (ISO8601) fields.",
        extraction_system: "You are an assistant that extracts metadata from conversations. Output JSON with 'agreed_upon_something' (boolean - true if participants made any agreement, promise, or commitment), 'entities' (array of strings - names of people, places, organizations, or topics mentioned), and 'emoji' (single emoji representing the conversation topic).",
        extraction_guidance: "",
      };
    }

    const promptVersion = createHash("sha256")
      .update(JSON.stringify(prompts))
      .digest("hex")
      .slice(0, 8);

    for (const chunk of chunksToProcess) {
      try {
        // Claim chunk for processing (atomic)
        const updateResult = await mongo({
          action: "updateOne",
          collection: "conversation_chunks",
          query: {
            _id: chunk._id,
            $or: [
              { state: "ready" },
              {
                state: "processing",
                processingStartedAt: { $lt: new Date(Date.now() - processingTimeoutMs) },
              },
            ],
          },
          update: {
            $set: {
              state: "processing",
              processingStartedAt: new Date(),
              processedByJobId: job.id,
            },
          },
        }) as { modifiedCount: number };

        if (updateResult.modifiedCount === 0) {
          // Another worker claimed it
          continue;
        }

        await job.updateProgress({
          stage: "processing_chunk",
          chunkId: chunk._id.toString(),
          chunksProcessed,
        });

        // Check extraction idempotency
        const extractionKey = generateExtractionKey(
          chunk._id.toString(),
          promptVersion,
          chunk.params.model,
          data.extractorVersion,
        );

        // Fetch transcriptions
        const transcriptions = await mongo({
          action: "find",
          collection: "transcriptions",
          query: { _id: { $in: chunk.transcriptionIds } },
          options: { sort: { start: 1 } },
        }) as Array<{
          start: Date;
          end: Date;
          segments?: Array<{ text: string }>;
        }>;

        if (!transcriptions || transcriptions.length === 0) {
          await mongo({
            action: "updateOne",
            collection: "conversation_chunks",
            query: { _id: chunk._id },
            update: { $set: { state: "empty", error: "No transcriptions found" } },
          });
          chunksProcessed++;
          continue;
        }

        // Convert to utterances
        const utterances: Utterance[] = transcriptions.map((t: any) => ({
          start: new Date(t.start),
          end: new Date(t.end),
          text: t.segments?.map((s: any) => s.text).join("").trim() ?? "",
        }));

        // Delete existing if force
        if (chunk.params.force) {
          await deleteConversationsInRange(objects, mongo, chunk.start, chunk.end);
        }

        // Format prompt
        const { prompt, start: chunkStart, end: chunkEnd } = formatChunkAsPrompt(utterances);

        await job.updateProgress({
          stage: "segmenting",
          chunkId: chunk._id.toString(),
        });

        // LLM Call #1: Segmentation
        const segments = await callLLMStructured(
          llm,
          chunk.params.model,
          [
            { role: "system", content: prompts.segmentation_system },
            { role: "user", content: prompt },
          ],
          parseSegmentationResponse,
        );

        // Clip and filter segments
        const clippedSegments = segments.map(s => clipSegmentTimes(s, chunkStart, chunkEnd));
        const segmentsWithUtterances = filterSegmentsWithUtterances(clippedSegments, utterances);

        if (segmentsWithUtterances.length === 0) {
          await mongo({
            action: "updateOne",
            collection: "conversation_chunks",
            query: { _id: chunk._id },
            update: {
              $set: {
                state: "empty",
                segmentsFound: 0,
                conversationsCreated: 0,
                extractionKey,
              },
            },
          });
          chunksProcessed++;
          continue;
        }

        // Process each segment
        let chunkConversations = 0;

        for (let i = 0; i < segmentsWithUtterances.length; i++) {
          const { segment, utterances: segUtterances } = segmentsWithUtterances[i];

          await job.updateProgress({
            stage: "extracting_metadata",
            chunkId: chunk._id.toString(),
            segment: i + 1,
            totalSegments: segmentsWithUtterances.length,
          });

          // Format segment prompt
          const { prompt: segPrompt } = formatChunkAsPrompt(segUtterances);

          // LLM Call #2: Metadata extraction (entities, emoji, agreed_upon_something)
          const extractionSystemPrompt = prompts.extraction_system || prompts.summarization_system;
          const extractionGuidance = prompts.extraction_guidance || prompts.summarization_guidance;
          
          const messages: Array<{ role: string; content: string }> = [
            { role: "system", content: extractionSystemPrompt },
            { role: "user", content: segPrompt },
          ];
          if (extractionGuidance) {
            messages.push({ role: "assistant", content: extractionGuidance });
          }

          const metadata = await callLLMStructured(
            llm,
            chunk.params.model,
            messages,
            parseMetadataResponse,
          );

          // Create conversation object (without summary - will be generated separately)
          // Validate required fields before creating
          if (segment.title == null || typeof segment.title !== 'string' || segment.title.trim().length === 0) {
            throw new Error(`Invalid segment title: ${JSON.stringify(segment.title)}`);
          }

          const conversationObject: Record<string, any> = {
            isConversation: true,
            name: segment.title.trim(),
            agreed_upon_something: metadata.agreed_upon_something,
            timeRanges: [{
              start: segment.start.toISOString(),
              end: segment.end.toISOString(),
            }],
            metadata: {
              extractedWith: {
                model: chunk.params.model,
                extractorVersion: data.extractorVersion,
                chunkId: chunk._id.toString(),
                timestamp: new Date().toISOString(),
              },
            },
          };

          // Only set icon if emoji was extracted
          if (metadata.emoji) {
            conversationObject.icon = { text: metadata.emoji };
          }

          const convResult = await objects({
            action: "create",
            object: conversationObject,
          }) as { insertedId: ObjectId };

          const conversationId = convResult.insertedId;

          // Create entity relationships
          for (const entityName of metadata.entities) {
            try {
              const entityId = await findOrCreateEntity(objects, entityName);
              await objects({
                action: "create",
                object: {
                  isRelationship: true,
                  name: "mentioned in",
                  relationship: {
                    subject: conversationId,
                    object: entityId,
                    symmetrical: false,
                  },
                },
              });
            } catch (error) {
              console.error(`Failed to create entity relationship for "${entityName}":`, error);
              errors.push({
                type: "entity_relationship",
                message: error instanceof Error ? error.message : String(error),
                conversationId: conversationId.toString(),
                entity: entityName,
              });
            }
          }

          // Queue a summarization job for the newly created conversation
          try {
            await jobs({
              action: "enqueue",
              data: {
                type: "summarization",
                start: segment.start.toISOString(),
                end: segment.end.toISOString(),
                objectId: conversationId.toString(),
              },
              trigger: {
                type: "auto",
                reason: `Triggered by conversation_extractor job ${job.id}`,
              },
            });
          } catch (error) {
            console.error(`Failed to queue summarization job for conversation ${conversationId}:`, error);
            errors.push({
              type: "summarization_job",
              message: error instanceof Error ? error.message : String(error),
              conversationId: conversationId.toString(),
            });
          }

          chunkConversations++;
          conversationsCreated++;
        }

        // Mark chunk completed
        await mongo({
          action: "updateOne",
          collection: "conversation_chunks",
          query: { _id: chunk._id },
          update: {
            $set: {
              state: "completed",
              segmentsFound: segmentsWithUtterances.length,
              conversationsCreated: chunkConversations,
              extractionKey,
            },
            $unset: { processingStartedAt: "" },
          },
        });

        chunksProcessed++;

      } catch (error) {
        console.error(`Failed to process chunk ${chunk._id}:`, error);
        
        await mongo({
          action: "updateOne",
          collection: "conversation_chunks",
          query: { _id: chunk._id },
          update: {
            $set: {
              state: "error",
              error: error instanceof Error ? error.message : String(error),
            },
            $unset: { processingStartedAt: "" },
          },
        });

        // Re-throw to fail the job - chunk state is saved, job can be retried
        throw error;
      }
    }

    return {
      status: "completed" as const,
      success: errors.length === 0,
      conversationsCreated,
      chunksProcessed,
      hasMore,
      ...(errors.length > 0 && { errors }),
    };
  },
  triggers: {
    sources: [
      {
        channel: "mycelia:mongo:conversation_chunks",
        name: "chunk_ready",
        filter: {
          event: "mongo.change",
          "data.operationType": { $in: ["insert", "update"] },
          "data.document.state": "ready",
        },
      },
    ],
    debounceMs: 5000,
    interval: 300,
  },
};

export default capability;
