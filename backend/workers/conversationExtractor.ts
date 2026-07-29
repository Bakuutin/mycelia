import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString, zObjectId } from "@myceliasdk/zod-json-schema.ts";
import { createHash } from "node:crypto";
import {
  getInferenceProvenance,
  type InferenceProvenance,
} from "@/lib/llm/provenance.ts";
import { createPromptCacheSessionId } from "@/lib/llm/prompt-cache-session.ts";

/**
 * Conversation Extractor
 *
 *  okay so what we have we have like a timeline of (overlapping) transcriptions
 * and then then when one person said something, and the other person said something and I want you to use ASCII art to represent it on a timeline.
 *
 *  10:00:00 - 10:00:09 - Person 1: "Hello"
 *  10:00:09 - 10:00:11 - Person 2: "Hello"
 *  10:00:20 - 10:00:30 - Person 1: "How are you?"
 *  10:00:30 - 10:00:40 - Person 2: "I'm good, thank you!"
 *  10:00:40 - 10:00:50 - Person 1: "What are you doing?"
 *  10:00:50 - 10:01:00 - Person 2: "I'm writing this docstring."
 *
 * This worker is responsible for extracting conversations from transcriptions and creating conversation objects.
 * It uses a LLM to segment the transcriptions into conversations and then extracts metadata from each conversation.
 * It then creates a conversation object for each conversation.
 */

// ============================================================================
// Types
// ============================================================================

interface Utterance {
  start: Date;
  end: Date;
  text: string;
}

interface TranscriptionInput {
  start: Date | string;
  end: Date | string;
  text?: string;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
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

interface EntityRelationshipResult {
  attempted: number;
  created: number;
  failed: number;
}

interface ConversationError {
  type: string;
  message: string;
  conversationId?: string;
  entity?: string;
}

interface ExtractedConversationArtifact {
  conversationId: string;
  title: string;
  emoji: string;
  entities: string[];
  agreementDetected: boolean;
  relationshipsAttempted: number;
  relationshipsCreated: number;
  relationshipErrors: number;
}

interface ChunkProcessingResult {
  claimed: boolean;
  conversationsCreated: number;
  segmentsFound: number;
  emojiCount: number;
  entityCount: number;
  agreementCount: number;
  relationshipsAttempted: number;
  relationshipsCreated: number;
  relationshipErrors: number;
  artifacts: ExtractedConversationArtifact[];
}

function emptyChunkResult(claimed: boolean): ChunkProcessingResult {
  return {
    claimed,
    conversationsCreated: 0,
    segmentsFound: 0,
    emojiCount: 0,
    entityCount: 0,
    agreementCount: 0,
    relationshipsAttempted: 0,
    relationshipsCreated: 0,
    relationshipErrors: 0,
    artifacts: [],
  };
}

export function describeExtractionResult(result: {
  chunksProcessed: number;
  segmentsFound: number;
  conversationsCreated: number;
  emojiCount: number;
  entityCount: number;
  agreementCount: number;
  relationshipsCreated: number;
  relationshipsAttempted: number;
  relationshipErrors: number;
}): string {
  if (result.chunksProcessed === 0) {
    return "No conversation chunks were ready to process; no extraction artifacts were created.";
  }
  if (result.conversationsCreated === 0) {
    return `Processed ${result.chunksProcessed} chunk(s), but found 0 usable conversation segments; created 0 conversations, 0 emoji, 0 entities, 0 agreements, and 0 entity links.`;
  }
  return `Processed ${result.chunksProcessed} chunk(s) and found ${result.segmentsFound} segment(s); created ${result.conversationsCreated} conversation(s), extracted ${result.emojiCount} emoji, ${result.entityCount} entities, and ${result.agreementCount} agreement(s), with ${result.relationshipsCreated}/${result.relationshipsAttempted} entity links created and ${result.relationshipErrors} link error(s).`;
}

type StructuredLLMResult<T> = {
  value: T;
  provenance: InferenceProvenance;
  attempts: InferenceProvenance[];
};

interface ConversationChunk {
  _id: ObjectId;
  chunkKey: string;
  start: Date;
  end: Date;
  transcriptionIds: ObjectId[];
  totalTextLength: number;
  state: string;
  extractionRetryCount?: number;
  extractionRetryAfter?: Date;
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
  extractorVersion: z.string().default("v2"),
  model: z.string().optional()
    .describe(
      "Optional model alias override for this run (for example small or medium); otherwise the chunk model is used",
    ),
  force: z.boolean().default(false)
    .describe(
      "Replace existing artifacts for the explicitly selected chunkId; force requires chunkId",
    ),
  fallbackModel: z.string()
    .default(Deno.env.get("CONVERSATION_EXTRACTION_FALLBACK_MODEL") ?? "")
    .describe(
      "Optional model retried once after a primary LLM error; empty means stop with error",
    ),
  retryNow: z.boolean().default(false)
    .describe(
      "Manual recovery: retry errored chunks immediately instead of waiting for backoff",
    ),

  // Prompt overrides (migrated from config.prompts)
  segmentation_system_prompt: z.string()
    .default(
      "You are an assistant that segments transcripts into distinct conversations. Output JSON with 'segments' array containing objects with 'title', 'start' (ISO8601), and 'end' (ISO8601) fields.",
    )
    .describe("System prompt for finding conversation topics in transcripts"),

  segmentation_guidance_prompt: z.string()
    .default("")
    .describe(
      "Additional guidance for conversation topic segmentation response format",
    ),

  extraction_system_prompt: z.string()
    .default(
      `You extract structured metadata from one conversation transcript.

Return all fields required by the response schema:
- agreed_upon_something: true only when the speakers made a concrete agreement, commitment, or decision; otherwise false.
- entities: deduplicated names of people, organizations, places, projects, products, or other stable named things explicitly mentioned in the transcript. Use concise canonical names. Do not include pronouns, unnamed people, generic common nouns, or conversation topics. Return [] when there are no qualifying entities.
- emoji: exactly one emoji that best represents the main subject of the conversation. Always return one emoji, even when the subject is broad.

Do not summarize the transcript and do not add fields outside the schema.`,
    )
    .describe("System prompt for extracting conversation metadata"),

  extraction_guidance_prompt: z.string()
    .default("")
    .describe("Guidance for conversation metadata extraction response format"),
}).superRefine((value, ctx) => {
  if (value.force && !value.chunkId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "force requires an explicit chunkId",
      path: ["chunkId"],
    });
  }
});

export type ConversationExtractorJobData = z.infer<typeof schema>;

// ============================================================================
// Pure Functions
// ============================================================================

export function shouldReplaceChunkArtifacts(
  chunkState: string,
  force: boolean,
): boolean {
  return force || chunkState === "processing";
}

const EXTRACTION_RETRY_BASE_MS = 5 * 60 * 1000;
const EXTRACTION_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export function getExtractionRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    EXTRACTION_RETRY_BASE_MS * 2 ** (safeAttempt - 1),
    EXTRACTION_RETRY_MAX_MS,
  );
}

function retryableChunkStateFilter(
  now: Date,
  processingTimeoutMs: number,
  retryNow = false,
) {
  return {
    $or: [
      { state: "ready" },
      {
        state: "processing",
        processingStartedAt: {
          $lt: new Date(now.getTime() - processingTimeoutMs),
        },
      },
      {
        state: "error",
        ...(retryNow ? {} : {
          $or: [
            { extractionRetryAfter: { $exists: false } },
            { extractionRetryAfter: { $lte: now } },
          ],
        }),
      },
    ],
  };
}

export function transcriptionToUtterances(
  transcription: TranscriptionInput,
): Utterance[] {
  const transcriptionStart = new Date(transcription.start);
  const transcriptionEnd = new Date(transcription.end);
  const segments = transcription.segments ?? [];

  const utterances = segments.flatMap((segment) => {
    const text = segment.text?.trim();
    if (!text) return [];

    const start = typeof segment.start === "number"
      ? new Date(transcriptionStart.getTime() + segment.start * 1000)
      : transcriptionStart;
    const end = typeof segment.end === "number"
      ? new Date(transcriptionStart.getTime() + segment.end * 1000)
      : transcriptionEnd;

    return [{
      start,
      end: new Date(Math.min(end.getTime(), transcriptionEnd.getTime())),
      text,
    }];
  });

  if (utterances.length > 0) return utterances;

  const fallbackText = transcription.text?.trim() ||
    segments.map((segment) => segment.text ?? "").join("").trim();
  return fallbackText
    ? [{ start: transcriptionStart, end: transcriptionEnd, text: fallbackText }]
    : [];
}

export function formatChunkAsPrompt(
  utterances: Utterance[],
): { prompt: string; start: Date; end: Date } {
  if (utterances.length === 0) {
    throw new Error("Cannot format empty utterances array");
  }

  const sorted = [...utterances].sort((a, b) =>
    new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  const strings: string[] = [];
  let latest = new Date(sorted[0].start);

  strings.push(`[time: ${new Date(sorted[0].start).toISOString()}]`);

  for (let index = 0; index < sorted.length; index++) {
    const u = sorted[index];
    const uStart = new Date(u.start);
    const gap = uStart.getTime() - latest.getTime();

    if (index > 0) {
      if (gap > 30 * 1000) { // > 30 seconds
        strings.push(`[time: ${latest.toISOString()}]`);
        const minutes = Math.floor(gap / 1000 / 60);
        const seconds = Math.floor((gap / 1000) % 60);
        strings.push(`[silence ${minutes}m ${seconds}s]`);
      }
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

function clipSegmentTimes(
  segment: Segment,
  chunkStart: Date,
  chunkEnd: Date,
): Segment {
  return {
    title: segment.title,
    start: new Date(
      Math.max(new Date(segment.start).getTime(), chunkStart.getTime()),
    ),
    end: new Date(
      Math.min(new Date(segment.end).getTime(), chunkEnd.getTime()),
    ),
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

    const overlapping = utterances.filter((u) => {
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
  fallbackModel: string,
  cacheTask: string,
  messages: Array<{ role: string; content: string }>,
  responseFormat: { type: "json_object" } | {
    type: "json_schema";
    json_schema: any;
  },
  parseResponse: (content: string) => T,
  logContext?: string,
): Promise<StructuredLLMResult<T>> {
  // OpenAI requires the word "json" in messages when using response_format: json_object
  // Ensure the first message (system prompt) includes it
  const adjustedMessages = [...messages];
  if (
    adjustedMessages.length > 0 &&
    !adjustedMessages[0].content.toLowerCase().includes("json")
  ) {
    adjustedMessages[0] = {
      ...adjustedMessages[0],
      content: adjustedMessages[0].content + " Respond in JSON format.",
    };
  }

  const sessionId = createPromptCacheSessionId(cacheTask, {
    messages: adjustedMessages.slice(0, -1),
    responseFormat,
  });

  const response = await llm({
    action: "completions",
    model,
    fallbackModel,
    session_id: sessionId,
    messages: adjustedMessages,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    console.log(
      `[ConvExtractor] ${logContext ?? "LLM"}: EMPTY response from LLM`,
    );
    throw new Error("Empty response from LLM");
  }

  // Log raw LLM response (truncated for sanity)
  const truncatedContent = content.length > 500
    ? content.slice(0, 500) + "...[truncated]"
    : content;
  console.log(
    `[ConvExtractor] ${
      logContext ?? "LLM"
    }: raw response (${content.length} chars): ${truncatedContent}`,
  );

  try {
    const provenance = getInferenceProvenance(response, model, fallbackModel);
    return {
      value: parseResponse(content),
      provenance,
      attempts: [provenance],
    };
  } catch (error) {
    console.log(
      `[ConvExtractor] ${
        logContext ?? "LLM"
      }: parse failed, retrying with fix prompt`,
    );
    // Retry once with a fix prompt
    const retryResponse = await llm({
      action: "completions",
      model,
      fallbackModel,
      session_id: sessionId,
      messages: [
        { role: "user", content: `Fix this JSON to be valid:\n${content}` },
      ],
      response_format: { type: "json_object" },
    });

    const retryContent = retryResponse.choices[0]?.message?.content;
    if (!retryContent) {
      throw new Error("Empty retry response from LLM");
    }

    console.log(
      `[ConvExtractor] ${logContext ?? "LLM"}: retry response: ${
        retryContent.slice(0, 300)
      }`,
    );
    const firstAttempt = getInferenceProvenance(response, model, fallbackModel);
    const retryProvenance = getInferenceProvenance(
      retryResponse,
      model,
      fallbackModel,
    );
    return {
      value: parseResponse(retryContent),
      provenance: retryProvenance,
      attempts: [firstAttempt, retryProvenance],
    };
  }
}

function buildSegmentationMessages(
  input: ConversationExtractorJobData,
  prompt: string,
) {
  const systemPrompt = input.segmentation_guidance_prompt
    ? `${input.segmentation_system_prompt}\n\nOutput guidance:\n${input.segmentation_guidance_prompt}`
    : input.segmentation_system_prompt;
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];
  return messages;
}

function buildMetadataMessages(
  input: ConversationExtractorJobData,
  prompt: string,
) {
  const systemPrompt = input.extraction_guidance_prompt
    ? `${input.extraction_system_prompt}\n\nOutput guidance:\n${input.extraction_guidance_prompt}`
    : input.extraction_system_prompt;
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];
  return messages;
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
    cleaned.indexOf("{") >= 0 ? cleaned.indexOf("{") : Infinity,
    cleaned.indexOf("[") >= 0 ? cleaned.indexOf("[") : Infinity,
  );

  if (jsonStart === Infinity) {
    const preview = cleaned.length > 200
      ? cleaned.slice(0, 200) + "..."
      : cleaned;
    throw new Error(
      `No JSON object or array found in response. Got: ${preview}`,
    );
  }

  // Find the matching closing bracket
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
    throw new Error("Could not find complete JSON object/array in response");
  }

  const jsonStr = cleaned.substring(jsonStart, jsonEnd);
  return JSON.parse(jsonStr);
}

/**
 * Parses prompt lines to extract time markers with their line indices.
 * Time markers are in the format: [time: ISO8601]
 */
function extractTimeMarkersFromPrompt(
  promptLines: string[],
): Array<{ lineIdx: number; time: Date }> {
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
function findTimeAtOrBeforeLine(
  markers: Array<{ lineIdx: number; time: Date }>,
  lineIdx: number,
): Date | undefined {
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
function findTimeAtOrAfterLine(
  markers: Array<{ lineIdx: number; time: Date }>,
  lineIdx: number,
): Date | undefined {
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
function findPhraseLine(promptLines: string[], phrase: string): number {
  const needle = phrase.trim().toLocaleLowerCase();
  if (!needle) return -1;
  return promptLines.findIndex((line) =>
    line.toLocaleLowerCase().includes(needle)
  );
}

export function createSegmentParser(
  promptLines: string[],
  chunkStart: Date,
  chunkEnd: Date,
) {
  const timeMarkers = extractTimeMarkersFromPrompt(promptLines);

  return function parseSegmentationResponse(content: string): Segment[] {
    const parsed = extractJsonFromText(content);
    const segments = parsed.segments || [];
    return segments.map((s: any, index: number) => {
      // Handle null, undefined, non-string, or empty string titles
      let title = `Segment ${index + 1}`;
      if (s.title != null && typeof s.title === "string") {
        const trimmed = s.title.trim();
        if (trimmed.length > 0) {
          title = trimmed;
        }
      }

      // Find any key starting with "start" and "end" (case-insensitive)
      const startVal = findAttrStartingWith(s, "start");
      const endVal = findAttrStartingWith(s, "end");

      if (startVal != null && endVal != null) {
        // Both numbers → line indices
        if (typeof startVal === "number" && typeof endVal === "number") {
          const start = findTimeAtOrBeforeLine(timeMarkers, startVal) ??
            findTimeAtOrAfterLine(timeMarkers, startVal) ??
            chunkStart;
          const end = findTimeAtOrAfterLine(timeMarkers, endVal) ??
            findTimeAtOrBeforeLine(timeMarkers, endVal) ??
            chunkEnd;
          return { title, start, end };
        }

        // Both strings → try as dates
        if (typeof startVal === "string" && typeof endVal === "string") {
          const start = new Date(startVal);
          const end = new Date(endVal);
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return { title, start, end };
          }

          // Some providers return phrase boundaries despite the JSON schema.
          // Resolve them against the timestamped STT lines rather than
          // expanding every topic to the full conversation chunk.
          const startLine = findPhraseLine(promptLines, startVal);
          const endLine = findPhraseLine(promptLines, endVal);
          if (startLine >= 0 && endLine >= startLine) {
            const phraseStart = findTimeAtOrBeforeLine(
              timeMarkers,
              startLine,
            ) ??
              chunkStart;
            const phraseEnd = findTimeAtOrAfterLine(
              timeMarkers,
              endLine + 1,
            ) ??
              chunkEnd;
            return { title, start: phraseStart, end: phraseEnd };
          }
        }
      }

      // Fallback: use chunk boundaries
      console.warn(
        `[ConvExtractor] Segment "${title}" has no valid time info (start=${
          JSON.stringify(startVal)
        }, end=${JSON.stringify(endVal)}), using chunk boundaries`,
      );
      return { title, start: chunkStart, end: chunkEnd };
    });
  };
}

export function parseMetadataResponse(content: string): ConversationMetadata {
  const parsed = extractJsonFromText(content);

  const emoji = normalizeEmoji(parsed.emoji);
  if (!emoji) {
    throw new Error("Metadata response did not contain a valid emoji");
  }

  const entities: string[] = [];
  const seenEntities = new Set<string>();
  if (Array.isArray(parsed.entities)) {
    for (const value of parsed.entities) {
      if (typeof value !== "string") continue;
      const name = value.trim();
      const key = name.toLocaleLowerCase();
      if (!name || seenEntities.has(key)) continue;
      seenEntities.add(key);
      entities.push(name);
    }
  }

  return {
    agreed_upon_something: Boolean(parsed.agreed_upon_something),
    entities,
    emoji,
  };
}

export function normalizeEmoji(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const emojiPattern =
    /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})/u;
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
    .segment(trimmed);
  for (const { segment } of graphemes) {
    if (emojiPattern.test(segment)) return segment;
  }
  return undefined;
}

export const metadataResponseSchema = z.object({
  agreed_upon_something: z.boolean(),
  entities: z.array(z.string()),
  emoji: z.string(),
});

// ============================================================================
// Entity Operations
// ============================================================================

const entityCache = new Map<string, ObjectId>();

async function findOrCreateEntity(
  objects: (input: any) => Promise<any>,
  name: string,
  generatedWith: Record<string, unknown>,
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
    object: {
      name,
      metadata: { generatedWith },
    },
  });

  entityCache.set(name, result.insertedId);
  return result.insertedId;
}

async function createEntityRelationships(
  objects: (input: any) => Promise<any>,
  conversationId: ObjectId,
  entityNames: string[],
  errors: ConversationError[],
  generatedWith: Record<string, unknown>,
): Promise<EntityRelationshipResult> {
  const result: EntityRelationshipResult = {
    attempted: entityNames.length,
    created: 0,
    failed: 0,
  };

  for (const entityName of entityNames) {
    try {
      const entityId = await findOrCreateEntity(
        objects,
        entityName,
        generatedWith,
      );
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
          metadata: { generatedWith },
        },
      });
      result.created++;
    } catch (error) {
      result.failed++;
      console.error(
        `Failed to create entity relationship for "${entityName}":`,
        error,
      );
      errors.push({
        type: "entity_relationship",
        message: error instanceof Error ? error.message : String(error),
        conversationId: conversationId.toString(),
        entity: entityName,
      });
    }
  }

  return result;
}

// ============================================================================
// Idempotency Operations
// ============================================================================

async function deleteConversationsForChunk(
  objects: (input: any) => Promise<any>,
  chunkId: ObjectId,
): Promise<number> {
  // Delete only artifacts created from this chunk. Range-based deletion can
  // remove valid conversations from overlapping chunks or manual imports.
  const conversations = await objects({
    action: "list",
    filters: {
      isConversation: true,
      "metadata.extractedWith.chunkId": chunkId.toString(),
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

async function processChunk(params: {
  chunk: ConversationChunk;
  input: ConversationExtractorJobData;
  mongo: (input: any) => Promise<any>;
  objects: (input: any) => Promise<any>;
  llm: (input: any) => Promise<any>;
  job: any;
  promptVersion: string;
  processingTimeoutMs: number;
  chunksProcessed: number;
  errors: ConversationError[];
}): Promise<ChunkProcessingResult> {
  const {
    chunk,
    input,
    mongo,
    objects,
    llm,
    job,
    promptVersion,
    processingTimeoutMs,
    chunksProcessed,
    errors,
  } = params;
  const model = input.model?.trim() || chunk.params.model;

  try {
    // Claim chunk for processing (atomic)
    const updateResult = await mongo({
      action: "updateOne",
      collection: "conversation_chunks",
      query: input.force && input.chunkId
        ? {
          _id: chunk._id,
          $or: [
            { state: { $ne: "processing" } },
            {
              state: "processing",
              processingStartedAt: {
                $lt: new Date(Date.now() - processingTimeoutMs),
              },
            },
          ],
        }
        : {
          _id: chunk._id,
          ...(input.chunkId
            ? {
              $or: [
                { state: "ready" },
                { state: "error" },
                {
                  state: "processing",
                  processingStartedAt: {
                    $lt: new Date(Date.now() - processingTimeoutMs),
                  },
                },
              ],
            }
            : retryableChunkStateFilter(new Date(), processingTimeoutMs)),
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
      return emptyChunkResult(false);
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
      model,
      input.extractorVersion,
    );

    // Fetch transcriptions
    const transcriptions = await mongo({
      action: "find",
      collection: "transcriptions",
      query: { _id: { $in: chunk.transcriptionIds } },
      options: { sort: { start: 1 } },
    }) as TranscriptionInput[];

    if (!transcriptions || transcriptions.length === 0) {
      console.log(
        `[ConvExtractor] Chunk ${chunk._id}: NO transcriptions found for IDs: ${
          chunk.transcriptionIds.map((id) => id.toString()).join(", ")
        }`,
      );
      await mongo({
        action: "updateOne",
        collection: "conversation_chunks",
        query: { _id: chunk._id },
        update: { $set: { state: "empty", error: "No transcriptions found" } },
      });
      return emptyChunkResult(true);
    }

    // Convert to utterances
    const utterances = transcriptions.flatMap(transcriptionToUtterances);

    console.log(
      `[ConvExtractor] Chunk ${chunk._id}: ${transcriptions.length} transcriptions, ${utterances.length} utterances`,
    );
    const totalTextLen = utterances.reduce((sum, u) => sum + u.text.length, 0);
    console.log(
      `[ConvExtractor] Chunk ${chunk._id}: total text length = ${totalTextLen} chars`,
    );
    if (utterances.length > 0) {
      console.log(
        `[ConvExtractor] Chunk ${chunk._id}: time range ${
          utterances[0].start.toISOString()
        } to ${utterances[utterances.length - 1].end.toISOString()}`,
      );
    }

    // A stale processing chunk may already have partial conversation objects
    // from an interrupted worker. Replace only artifacts owned by this chunk
    // before retrying so recovery cannot create duplicates.
    if (
      shouldReplaceChunkArtifacts(
        chunk.state,
        input.force || chunk.params.force,
      )
    ) {
      await deleteConversationsForChunk(objects, chunk._id);
    }

    // Format prompt
    const { prompt, start: chunkStart, end: chunkEnd } = formatChunkAsPrompt(
      utterances,
    );
    console.log(
      `[ConvExtractor] Chunk ${chunk._id}: prompt length = ${prompt.length} chars`,
    );

    await job.updateProgress({
      stage: "segmenting",
      chunkId: chunk._id.toString(),
    });

    // LLM Call #1: Segmentation
    console.log(
      `[ConvExtractor] Chunk ${chunk._id}: calling LLM for segmentation (prompt ${prompt.length} chars)...`,
    );
    const promptLines = prompt.split("\n");
    const segmentationMessages = buildSegmentationMessages(input, prompt);
    const segmentationRun = await callLLMStructured(
      llm,
      model,
      input.fallbackModel,
      "conversation-extractor-segmentation",
      segmentationMessages,
      {
        type: "json_schema",
        json_schema: z.object({
          segments: z.array(z.object({
            title: z.string(),
            start: z.string(),
            end: z.string(),
          })),
        }).toJSONSchema(),
      },
      createSegmentParser(promptLines, chunkStart, chunkEnd),
      `Chunk ${chunk._id} segmentation`,
    );
    const segments = segmentationRun.value;
    console.log(
      `[ConvExtractor] Chunk ${chunk._id}: LLM returned ${segments.length} segments`,
    );
    for (const seg of segments) {
      console.log(
        `[ConvExtractor]   - "${seg.title}" ${seg.start.toISOString()} to ${seg.end.toISOString()}`,
      );
    }

    // Clip and filter segments
    const clippedSegments = segments.map((s) =>
      clipSegmentTimes(s, chunkStart, chunkEnd)
    );
    const segmentsWithUtterances = filterSegmentsWithUtterances(
      clippedSegments,
      utterances,
    );
    console.log(
      `[ConvExtractor] Chunk ${chunk._id}: after filtering, ${segmentsWithUtterances.length} segments have utterances`,
    );

    if (segmentsWithUtterances.length === 0) {
      console.log(
        `[ConvExtractor] Chunk ${chunk._id}: NO segments with utterances - marking as empty`,
      );
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
            inferenceProvenance: {
              segmentation: {
                task: "conversation_segmentation",
                ...segmentationRun.provenance,
                attempts: segmentationRun.attempts,
                jobId: job.id,
                generatedAt: new Date(),
              },
              metadata: [],
            },
          },
        },
      });
      return emptyChunkResult(true);
    }

    // Process each segment
    let chunkConversations = 0;
    let emojiCount = 0;
    let entityCount = 0;
    let agreementCount = 0;
    let relationshipsAttempted = 0;
    let relationshipsCreated = 0;
    let relationshipErrors = 0;
    const artifacts: ExtractedConversationArtifact[] = [];
    const metadataRuns: Array<Record<string, unknown>> = [];

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
      const messages = buildMetadataMessages(input, segPrompt);

      const metadataRun = await callLLMStructured(
        llm,
        model,
        input.fallbackModel,
        "conversation-extractor-metadata",
        messages,
        {
          type: "json_schema",
          json_schema: metadataResponseSchema.toJSONSchema(),
        },
        parseMetadataResponse,
        `Chunk ${chunk._id} segment ${
          i + 1
        }/${segmentsWithUtterances.length} metadata`,
      );
      const metadata = metadataRun.value;
      console.log(
        `[ConvExtractor] Chunk ${chunk._id} segment ${
          i + 1
        }: metadata extracted - entities=${metadata.entities.length}, emoji=${
          metadata.emoji ?? "none"
        }, agreed=${metadata.agreed_upon_something}`,
      );

      // Create conversation object (without summary - will be generated separately)
      // Validate required fields before creating
      if (
        segment.title == null || typeof segment.title !== "string" ||
        segment.title.trim().length === 0
      ) {
        throw new Error(
          `Invalid segment title: ${JSON.stringify(segment.title)}`,
        );
      }

      const generatedAt = new Date();
      const extractionProvenance = {
        task: "conversation_extraction",
        requestedModel: metadataRun.provenance.requestedModel,
        resolvedModel: metadataRun.provenance.resolvedModel,
        responseModel: metadataRun.provenance.responseModel,
        fallbackModel: metadataRun.provenance.fallbackModel,
        fallbackUsed: metadataRun.provenance.fallbackUsed,
        providerBaseUrl: metadataRun.provenance.providerBaseUrl,
        providerProfileId: metadataRun.provenance.providerProfileId,
        providerProfileName: metadataRun.provenance.providerProfileName,
        segmentation: {
          task: "conversation_segmentation",
          ...segmentationRun.provenance,
          attempts: segmentationRun.attempts,
        },
        metadata: {
          task: "conversation_metadata",
          ...metadataRun.provenance,
          attempts: metadataRun.attempts,
        },
        jobId: job.id,
        chunkId: chunk._id.toString(),
        generatedAt,
      };

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
            // Keep the historical field, but make it the model that actually
            // produced the persisted metadata. requestedModel preserves aliases.
            model: metadataRun.provenance.resolvedModel,
            requestedModel: metadataRun.provenance.requestedModel,
            resolvedModel: metadataRun.provenance.resolvedModel,
            responseModel: metadataRun.provenance.responseModel,
            fallbackModel: metadataRun.provenance.fallbackModel,
            fallbackUsed: metadataRun.provenance.fallbackUsed,
            providerBaseUrl: metadataRun.provenance.providerBaseUrl,
            providerProfileId: metadataRun.provenance.providerProfileId,
            providerProfileName: metadataRun.provenance.providerProfileName,
            extractorVersion: input.extractorVersion,
            chunkId: chunk._id.toString(),
            jobId: job.id,
            timestamp: generatedAt,
            operations: {
              segmentation: extractionProvenance.segmentation,
              metadata: extractionProvenance.metadata,
            },
            result: {
              schemaVersion: "v2",
              status: "metadata_extracted",
              emojiPresent: true,
              entityCount: metadata.entities.length,
              relationshipsAttempted: metadata.entities.length,
              relationshipsCreated: 0,
              relationshipErrors: 0,
            },
          },
          aiProvenance: { extraction: extractionProvenance },
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
      console.log(
        `[ConvExtractor] Chunk ${chunk._id}: CREATED conversation ${conversationId} - "${segment.title}" (${segment.start.toISOString()} to ${segment.end.toISOString()})`,
      );

      const relationshipResult = await createEntityRelationships(
        objects,
        conversationId,
        metadata.entities,
        errors,
        {
          ...extractionProvenance,
          task: "entity_extraction",
          subjectId: conversationId.toString(),
        },
      );

      emojiCount += metadata.emoji ? 1 : 0;
      entityCount += metadata.entities.length;
      agreementCount += metadata.agreed_upon_something ? 1 : 0;
      relationshipsAttempted += relationshipResult.attempted;
      relationshipsCreated += relationshipResult.created;
      relationshipErrors += relationshipResult.failed;
      artifacts.push({
        conversationId: conversationId.toString(),
        title: segment.title.trim(),
        emoji: metadata.emoji ?? "",
        entities: metadata.entities,
        agreementDetected: metadata.agreed_upon_something,
        relationshipsAttempted: relationshipResult.attempted,
        relationshipsCreated: relationshipResult.created,
        relationshipErrors: relationshipResult.failed,
      });

      await job.updateProgress({
        stage: "extracting_metadata",
        chunkId: chunk._id.toString(),
        chunksProcessed,
        segment: i + 1,
        totalSegments: segmentsWithUtterances.length,
        conversationsCreated: chunkConversations + 1,
        emojiCount,
        entityCount,
        agreementCount,
        relationshipsCreated,
        relationshipErrors,
      });

      try {
        const latestConversation = await objects({
          action: "get",
          id: conversationId.toString(),
        });
        await objects({
          action: "update",
          id: conversationId.toString(),
          version: latestConversation.version ?? 0,
          field: "metadata.extractedWith.result",
          value: {
            schemaVersion: "v2",
            status: relationshipResult.failed === 0
              ? "completed"
              : "completed_with_relationship_errors",
            emojiPresent: true,
            entityCount: metadata.entities.length,
            relationshipsAttempted: relationshipResult.attempted,
            relationshipsCreated: relationshipResult.created,
            relationshipErrors: relationshipResult.failed,
          },
        });
      } catch (error) {
        console.error(
          `Failed to persist extraction result for conversation ${conversationId}:`,
          error,
        );
        errors.push({
          type: "extraction_result",
          message: error instanceof Error ? error.message : String(error),
          conversationId: conversationId.toString(),
        });
      }

      metadataRuns.push({
        ...extractionProvenance.metadata,
        conversationId: conversationId.toString(),
        generatedAt,
      });

      chunkConversations++;
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
          inferenceProvenance: {
            segmentation: {
              task: "conversation_segmentation",
              ...segmentationRun.provenance,
              attempts: segmentationRun.attempts,
              jobId: job.id,
              generatedAt: new Date(),
            },
            metadata: metadataRuns,
          },
        },
        $unset: {
          processingStartedAt: "",
          extractionRetryAfter: "",
          error: "",
        },
      },
    });

    return {
      claimed: true,
      conversationsCreated: chunkConversations,
      segmentsFound: segmentsWithUtterances.length,
      emojiCount,
      entityCount,
      agreementCount,
      relationshipsAttempted,
      relationshipsCreated,
      relationshipErrors,
      artifacts,
    };
  } catch (error) {
    console.error(`Failed to process chunk ${chunk._id}:`, error);

    const retryCount = (chunk.extractionRetryCount ?? 0) + 1;
    const failedAt = new Date();
    const retryAfter = new Date(
      failedAt.getTime() + getExtractionRetryDelayMs(retryCount),
    );

    await mongo({
      action: "updateOne",
      collection: "conversation_chunks",
      query: { _id: chunk._id },
      update: {
        $set: {
          state: "error",
          error: error instanceof Error ? error.message : String(error),
          extractionRetryCount: retryCount,
          extractionLastErrorAt: failedAt,
          extractionRetryAfter: retryAfter,
        },
        $unset: { processingStartedAt: "" },
      },
    });

    // Re-throw to fail the job - chunk state is saved, job can be retried
    throw error;
  }
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
    processed: z.number(),
    description: z.string(),
    segmentsFound: z.number(),
    emojiCount: z.number(),
    entityCount: z.number(),
    agreementCount: z.number(),
    relationshipsAttempted: z.number(),
    relationshipsCreated: z.number(),
    relationshipErrors: z.number(),
    artifacts: z.array(z.object({
      conversationId: z.string(),
      title: z.string(),
      emoji: z.string(),
      entities: z.array(z.string()),
      agreementDetected: z.boolean(),
      relationshipsAttempted: z.number(),
      relationshipsCreated: z.number(),
      relationshipErrors: z.number(),
    })),
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
  ],
  maxConcurrency: 1,
  use: async (job) => {
    const input = job.data as ConversationExtractorJobData;
    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = Deno.env.get("MYCELIA_URL")!;

    const mongo = (input: any) =>
      callResource("mongo", input, { jwt, myceliaUrl });
    const objects = (input: any) =>
      callResource("objects", input, { jwt, myceliaUrl });
    const llm = (input: any) => callResource("llm", input, { jwt, myceliaUrl });

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
      const stateFilter = retryableChunkStateFilter(
        new Date(),
        processingTimeoutMs,
        input.retryNow,
      );

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
          limit: input.limit + 1, // +1 to check if there's more
        },
      }) as ConversationChunk[];
    }

    const hasMore = chunks.length > input.limit;
    const chunksToProcess = chunks.slice(0, input.limit);

    console.log(
      `[ConvExtractor] Job ${job.id}: found ${chunks.length} chunks, processing ${chunksToProcess.length}, hasMore=${hasMore}`,
    );
    for (const c of chunksToProcess) {
      console.log(
        `[ConvExtractor]   - Chunk ${c._id}: state=${c.state}, transcriptionIds=${
          c.transcriptionIds?.length ?? 0
        }, start=${c.start?.toISOString?.() ?? "N/A"}`,
      );
    }

    let conversationsCreated = 0;
    let chunksProcessed = 0;
    let segmentsFound = 0;
    let emojiCount = 0;
    let entityCount = 0;
    let agreementCount = 0;
    let relationshipsAttempted = 0;
    let relationshipsCreated = 0;
    let relationshipErrors = 0;
    const artifacts: ExtractedConversationArtifact[] = [];
    const errors: ConversationError[] = [];

    // Compute prompt version for idempotency (based on prompts that affect output)
    const promptVersion = createHash("sha256")
      .update(
        input.segmentation_system_prompt + input.segmentation_guidance_prompt +
          input.extraction_system_prompt + input.extraction_guidance_prompt,
      )
      .digest("hex")
      .slice(0, 8);

    for (const chunk of chunksToProcess) {
      const result = await processChunk({
        chunk,
        input,
        mongo,
        objects,
        llm,
        job,
        promptVersion,
        processingTimeoutMs,
        chunksProcessed,
        errors,
      });

      if (!result.claimed) {
        continue;
      }

      chunksProcessed++;
      conversationsCreated += result.conversationsCreated;
      segmentsFound += result.segmentsFound;
      emojiCount += result.emojiCount;
      entityCount += result.entityCount;
      agreementCount += result.agreementCount;
      relationshipsAttempted += result.relationshipsAttempted;
      relationshipsCreated += result.relationshipsCreated;
      relationshipErrors += result.relationshipErrors;
      artifacts.push(...result.artifacts);
    }

    const metrics = {
      chunksProcessed,
      segmentsFound,
      conversationsCreated,
      emojiCount,
      entityCount,
      agreementCount,
      relationshipsCreated,
      relationshipsAttempted,
      relationshipErrors,
    };

    return {
      status: "completed" as const,
      success: errors.length === 0,
      conversationsCreated,
      chunksProcessed,
      processed: chunksProcessed,
      description: describeExtractionResult(metrics),
      segmentsFound,
      emojiCount,
      entityCount,
      agreementCount,
      relationshipsAttempted,
      relationshipsCreated,
      relationshipErrors,
      artifacts,
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
