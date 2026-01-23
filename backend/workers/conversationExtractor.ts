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
  
  // Prompt overrides (migrated from config.prompts)
  segmentation_system_prompt: z.string()
    .default("You are an assistant that segments transcripts into distinct conversations. Output JSON with 'segments' array containing objects with 'title', 'start' (ISO8601), and 'end' (ISO8601) fields.")
    .describe("System prompt for finding conversation topics in transcripts"),
  
  segmentation_guidance_prompt: z.string()
    .default("")
    .describe("Additional guidance for conversation topic segmentation response format"),
  
  extraction_system_prompt: z.string()
    .default("You are an assistant that extracts metadata from conversations. Output JSON with 'agreed_upon_something' (boolean - true if participants made any agreement, promise, or commitment), 'entities' (array of strings - names of people, places, organizations, or topics mentioned), and 'emoji' (single emoji representing the conversation topic).")
    .describe("System prompt for extracting conversation metadata"),
  
  extraction_guidance_prompt: z.string()
    .default("")
    .describe("Guidance for conversation metadata extraction response format"),
});

export type ConversationExtractorJobData = z.infer<typeof schema>;


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

async function callLLMStructured<T>(
  llm: (input: any) => Promise<any>,
  model: string,
  messages: Array<{ role: string; content: string }>,
  parseResponse: (content: string) => T,
  logContext?: string,
): Promise<T> {
  const response = await llm({
    action: "completions",
    model,
    messages,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    console.log(`[ConvExtractor] ${logContext ?? 'LLM'}: EMPTY response from LLM`);
    throw new Error("Empty response from LLM");
  }

  // Log raw LLM response (truncated for sanity)
  const truncatedContent = content.length > 500 ? content.slice(0, 500) + '...[truncated]' : content;
  console.log(`[ConvExtractor] ${logContext ?? 'LLM'}: raw response (${content.length} chars): ${truncatedContent}`);

  try {
    return parseResponse(content);
  } catch (error) {
    console.log(`[ConvExtractor] ${logContext ?? 'LLM'}: parse failed, retrying with fix prompt`);
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

    console.log(`[ConvExtractor] ${logContext ?? 'LLM'}: retry response: ${retryContent.slice(0, 300)}`);
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

/**
 * Parses prompt lines to extract time markers with their line indices.
 * Time markers are in the format: [time: ISO8601]
 */
function extractTimeMarkersFromPrompt(promptLines: string[]): Array<{ lineIdx: number; time: Date }> {
  const markers: Array<{ lineIdx: number; time: Date }> = [];
  const timeRegex = /^\[time:\s*(.+)\]$/;
  
  for (let i = 0; i < promptLines.length; i++) {
    const match = promptLines[i].match(timeRegex);
    if (match) {
      const time = new Date(match[1]);
      if (!isNaN(time.getTime())) {
        markers.push({ lineIdx: i, time });
      }
    }
  }
  
  return markers;
}

/**
 * Finds the time at or before a given line index using time markers.
 * Returns undefined if no suitable marker is found.
 */
function findTimeAtOrBeforeLine(markers: Array<{ lineIdx: number; time: Date }>, lineIdx: number): Date | undefined {
  // Find the last marker at or before the given line
  let result: Date | undefined;
  for (const marker of markers) {
    if (marker.lineIdx <= lineIdx) {
      result = marker.time;
    } else {
      break;
    }
  }
  return result;
}

/**
 * Finds the time at or after a given line index using time markers.
 * Returns undefined if no suitable marker is found.
 */
function findTimeAtOrAfterLine(markers: Array<{ lineIdx: number; time: Date }>, lineIdx: number): Date | undefined {
  for (const marker of markers) {
    if (marker.lineIdx >= lineIdx) {
      return marker.time;
    }
  }
  return undefined;
}

/**
 * Finds attribute value by prefix (case-insensitive).
 * Returns the value of the first key starting with the prefix, or undefined.
 */
function findAttrStartingWith(obj: Record<string, any>, prefix: string): any {
  const lowerPrefix = prefix.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase().startsWith(lowerPrefix)) {
      return obj[key];
    }
  }
  return undefined;
}

/**
 * Creates a segment parser that can handle various LLM response formats.
 * Finds any key containing "start" and "end", then parses both as either:
 * - Dates (if both are valid date strings)
 * - Line indices (if both are numbers)
 */
function createSegmentParser(promptLines: string[], chunkStart: Date, chunkEnd: Date) {
  const timeMarkers = extractTimeMarkersFromPrompt(promptLines);
  
  return function parseSegmentationResponse(content: string): Segment[] {
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
      
      // Find any key starting with "start" and "end" (case-insensitive)
      const startVal = findAttrStartingWith(s, 'start');
      const endVal = findAttrStartingWith(s, 'end');
      
      if (startVal != null && endVal != null) {
        // Both numbers → line indices
        if (typeof startVal === 'number' && typeof endVal === 'number') {
          const start = findTimeAtOrBeforeLine(timeMarkers, startVal) 
            ?? findTimeAtOrAfterLine(timeMarkers, startVal) 
            ?? chunkStart;
          const end = findTimeAtOrAfterLine(timeMarkers, endVal) 
            ?? findTimeAtOrBeforeLine(timeMarkers, endVal) 
            ?? chunkEnd;
          return { title, start, end };
        }
        
        // Both strings → try as dates
        if (typeof startVal === 'string' && typeof endVal === 'string') {
          const start = new Date(startVal);
          const end = new Date(endVal);
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return { title, start, end };
          }
        }
      }
      
      // Fallback: use chunk boundaries
      console.warn(`[ConvExtractor] Segment "${title}" has no valid time info (start=${JSON.stringify(startVal)}, end=${JSON.stringify(endVal)}), using chunk boundaries`);
      return { title, start: chunkStart, end: chunkEnd };
    });
  };
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
    const input = job.data as ConversationExtractorJobData;
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
    
    if (input.chunkId) {
      const chunk = await mongo({
        action: "findOne",
        collection: "conversation_chunks",
        query: { _id: new ObjectId(input.chunkId) },
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
      if (input.start) dateFilter.$gte = new Date(input.start);
      if (input.end) dateFilter.$lt = new Date(input.end);

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
          limit: input.limit + 1,  // +1 to check if there's more
        },
      }) as ConversationChunk[];
    }

    const hasMore = chunks.length > input.limit;
    const chunksToProcess = chunks.slice(0, input.limit);

    console.log(`[ConvExtractor] Job ${job.id}: found ${chunks.length} chunks, processing ${chunksToProcess.length}, hasMore=${hasMore}`);
    for (const c of chunksToProcess) {
      console.log(`[ConvExtractor]   - Chunk ${c._id}: state=${c.state}, transcriptionIds=${c.transcriptionIds?.length ?? 0}, start=${c.start?.toISOString?.() ?? 'N/A'}`);
    }

    let conversationsCreated = 0;
    let chunksProcessed = 0;
    const errors: Array<{ type: string; message: string; conversationId?: string; entity?: string }> = [];

    // Compute prompt version for idempotency (based on prompts that affect output)
    const promptVersion = createHash("sha256")
      .update(input.segmentation_system_prompt + input.extraction_system_prompt)
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
          input.extractorVersion,
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
          console.log(`[ConvExtractor] Chunk ${chunk._id}: NO transcriptions found for IDs: ${chunk.transcriptionIds.map(id => id.toString()).join(', ')}`);
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

        console.log(`[ConvExtractor] Chunk ${chunk._id}: ${transcriptions.length} transcriptions, ${utterances.length} utterances`);
        const totalTextLen = utterances.reduce((sum, u) => sum + u.text.length, 0);
        console.log(`[ConvExtractor] Chunk ${chunk._id}: total text length = ${totalTextLen} chars`);
        if (utterances.length > 0) {
          console.log(`[ConvExtractor] Chunk ${chunk._id}: time range ${utterances[0].start.toISOString()} to ${utterances[utterances.length - 1].end.toISOString()}`);
        }

        // Delete existing if force
        if (chunk.params.force) {
          await deleteConversationsInRange(objects, mongo, chunk.start, chunk.end);
        }

        // Format prompt
        const { prompt, start: chunkStart, end: chunkEnd } = formatChunkAsPrompt(utterances);
        console.log(`[ConvExtractor] Chunk ${chunk._id}: prompt length = ${prompt.length} chars`);

        await job.updateProgress({
          stage: "segmenting",
          chunkId: chunk._id.toString(),
        });

        // LLM Call #1: Segmentation
        console.log(`[ConvExtractor] Chunk ${chunk._id}: calling LLM for segmentation (prompt ${prompt.length} chars)...`);
        const promptLines = prompt.split('\n');
        const segments = await callLLMStructured(
          llm,
          chunk.params.model,
          [
            { role: "system", content: input.segmentation_system_prompt },
            { role: "user", content: prompt },
          ],
          createSegmentParser(promptLines, chunkStart, chunkEnd),
          `Chunk ${chunk._id} segmentation`,
        );
        console.log(`[ConvExtractor] Chunk ${chunk._id}: LLM returned ${segments.length} segments`);
        for (const seg of segments) {
          console.log(`[ConvExtractor]   - "${seg.title}" ${seg.start.toISOString()} to ${seg.end.toISOString()}`);
        }

        // Clip and filter segments
        const clippedSegments = segments.map(s => clipSegmentTimes(s, chunkStart, chunkEnd));
        const segmentsWithUtterances = filterSegmentsWithUtterances(clippedSegments, utterances);
        console.log(`[ConvExtractor] Chunk ${chunk._id}: after filtering, ${segmentsWithUtterances.length} segments have utterances`);

        if (segmentsWithUtterances.length === 0) {
          console.log(`[ConvExtractor] Chunk ${chunk._id}: NO segments with utterances - marking as empty`);
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
          const messages: Array<{ role: string; content: string }> = [
            { role: "system", content: input.extraction_system_prompt },
            { role: "user", content: segPrompt },
          ];
          if (input.extraction_guidance_prompt) {
            messages.push({ role: "assistant", content: input.extraction_guidance_prompt });
          }

          const metadata = await callLLMStructured(
            llm,
            chunk.params.model,
            messages,
            parseMetadataResponse,
            `Chunk ${chunk._id} segment ${i + 1}/${segmentsWithUtterances.length} metadata`,
          );
          console.log(`[ConvExtractor] Chunk ${chunk._id} segment ${i + 1}: metadata extracted - entities=${metadata.entities.length}, emoji=${metadata.emoji ?? 'none'}, agreed=${metadata.agreed_upon_something}`);

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
                extractorVersion: input.extractorVersion,
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
          console.log(`[ConvExtractor] Chunk ${chunk._id}: CREATED conversation ${conversationId} - "${segment.title}" (${segment.start.toISOString()} to ${segment.end.toISOString()})`);

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
