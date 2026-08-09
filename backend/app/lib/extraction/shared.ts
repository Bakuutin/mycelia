import { ObjectId } from "bson";
import { extractJsonFromText } from "../llm/worker-response.ts";

/**
 * Extraction-domain code shared by the conversation extractor, entity typing
 * and tagging workers: the entity taxonomy, transcript→prompt formatting,
 * segmentation-response parsing, and the persistence helpers that turn
 * extracted entities/tags into objects and relationships.
 *
 * Moved out of the legacy conversation_extractor worker when it was removed;
 * conversation_extractor_merged is the only extractor.
 */

// ============================================================================
// Types
// ============================================================================

export interface Utterance {
  start: Date;
  end: Date;
  text: string;
}

export interface TranscriptionInput {
  start: Date | string;
  end: Date | string;
  text?: string;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
}

export interface Segment {
  title: string;
  start: Date;
  end: Date;
}

export interface ConversationError {
  type: string;
  message: string;
  conversationId?: string;
  entity?: string;
}

export interface ConversationChunk {
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

export interface ExtractionTag {
  _id: ObjectId;
  name: string;
  details?: string;
}

// ============================================================================
// Entity taxonomy
// ============================================================================

export const ENTITY_TYPES = [
  "person",
  "place",
  "organization",
  "product",
  "project",
  "event",
  "animal",
  "concept",
  "media",
  "other",
] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}

export const ENTITY_TYPE_FLAG: Partial<Record<EntityType, string>> = {
  person: "isPerson",
  place: "isPlace",
  organization: "isOrganization",
  product: "isProduct",
  project: "isProject",
  event: "isEvent",
  animal: "isAnimal",
  concept: "isConcept",
  media: "isMedia",
};

// Every type flag on objects. A key that exists — even with value false —
// means someone (user or job) already made a typing decision.
export const TYPE_FLAG_FIELDS = [
  "isPerson",
  "isEvent",
  "isRelationship",
  "isPromise",
  "isConversation",
  "isTag",
  "isPlace",
  "isOrganization",
  "isProduct",
  "isProject",
  "isAnimal",
  "isConcept",
  "isMedia",
];

export function hasAnyTypeFlagKey(obj: Record<string, unknown>): boolean {
  return TYPE_FLAG_FIELDS.some((field) =>
    field in obj && obj[field] !== undefined
  );
}

// ============================================================================
// Retry policy
// ============================================================================

const EXTRACTION_RETRY_BASE_MS = 5 * 60 * 1000;
const EXTRACTION_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export function getExtractionRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    EXTRACTION_RETRY_BASE_MS * 2 ** (safeAttempt - 1),
    EXTRACTION_RETRY_MAX_MS,
  );
}

// ============================================================================
// Transcript → prompt
// ============================================================================

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

/**
 * Tag selection happens inside the metadata call: the transcript is already
 * being sent for entities/emoji, so the tag list is the only extra cost.
 * The tagger worker remains as a manual/backfill pass for tags added later.
 */
export function buildTagListPrompt(tags: ExtractionTag[]): string {
  if (tags.length === 0) return "";
  const lines = tags.map((tag) =>
    tag.details ? `- ${tag.name}: ${tag.details}` : `- ${tag.name}`
  );
  return `\n\nAvailable tags:\n${
    lines.join("\n")
  }\n- tags: array of tag names from the list above that clearly apply to this conversation. Use exact names, be conservative, and return [] when none apply.`;
}

// ============================================================================
// Segmentation-response parsing
// ============================================================================

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

/** Last marker at or before the given line, if any. */
function findTimeAtOrBeforeLine(
  markers: Array<{ lineIdx: number; time: Date }>,
  lineIdx: number,
): Date | undefined {
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

/** First marker at or after the given line, if any. */
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

function findPhraseLine(promptLines: string[], phrase: string): number {
  const needle = phrase.trim().toLocaleLowerCase();
  if (!needle) return -1;
  return promptLines.findIndex((line) =>
    line.toLocaleLowerCase().includes(needle)
  );
}

/**
 * Creates a segment parser that can handle various LLM response formats.
 * Finds any key containing "start" and "end", then parses both as either
 * dates (valid date strings), line indices (numbers), or verbatim phrase
 * boundaries resolved against the timestamped transcript lines.
 */
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

        // Both strings → try as dates. V8 date parsing is lenient enough to
        // turn transcript phrases into dates (new Date("Так, 300.") is the
        // year 300), so a parse only counts when both dates land near the
        // chunk window; otherwise fall through to phrase resolution.
        if (typeof startVal === "string" && typeof endVal === "string") {
          const start = new Date(startVal);
          const end = new Date(endVal);
          const windowStart = chunkStart.getTime() - 24 * 60 * 60 * 1000;
          const windowEnd = chunkEnd.getTime() + 24 * 60 * 60 * 1000;
          const plausible = (date: Date) =>
            !isNaN(date.getTime()) &&
            date.getTime() >= windowStart && date.getTime() <= windowEnd;
          if (plausible(start) && plausible(end)) {
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
        `[Extraction] Segment "${title}" has no valid time info (start=${
          JSON.stringify(startVal)
        }, end=${JSON.stringify(endVal)}), using chunk boundaries`,
      );
      return { title, start: chunkStart, end: chunkEnd };
    });
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

// ============================================================================
// Entity/tag persistence
// ============================================================================

interface EntityRelationshipResult {
  attempted: number;
  created: number;
  failed: number;
}

const entityCache = new Map<string, ObjectId>();

async function findOrCreateEntity(
  objects: (input: any) => Promise<any>,
  name: string,
  type: EntityType,
  generatedWith: Record<string, unknown>,
): Promise<ObjectId> {
  // Check cache first
  const cached = entityCache.get(name);
  if (cached) return cached;

  const flagField = ENTITY_TYPE_FLAG[type];

  // Check DB
  const existing = await objects({
    action: "list",
    filters: { name },
    options: { limit: 1 },
  });

  if (existing && existing.length > 0) {
    const doc = existing[0];
    // Backfill-on-touch: type an existing untyped entity, but only when no
    // type-flag key exists at all — an explicit false is a manual decision.
    if (flagField && !hasAnyTypeFlagKey(doc)) {
      try {
        await objects({
          action: "update",
          id: doc._id.toString(),
          version: doc.version ?? 0,
          field: flagField,
          value: true,
        });
      } catch {
        // Concurrent edit — keep whatever the other writer decided.
      }
    }
    entityCache.set(name, doc._id);
    return doc._id;
  }

  // Create new
  const result = await objects({
    action: "create",
    object: {
      name,
      ...(flagField ? { [flagField]: true } : {}),
      metadata: { generatedWith: { ...generatedWith, entityType: type } },
    },
  });

  entityCache.set(name, result.insertedId);
  return result.insertedId;
}

export async function createEntityRelationships(
  objects: (input: any) => Promise<any>,
  conversationId: ObjectId,
  entities: ExtractedEntity[],
  errors: ConversationError[],
  generatedWith: Record<string, unknown>,
): Promise<EntityRelationshipResult> {
  const result: EntityRelationshipResult = {
    attempted: entities.length,
    created: 0,
    failed: 0,
  };

  for (const entity of entities) {
    try {
      const entityId = await findOrCreateEntity(
        objects,
        entity.name,
        entity.type,
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
        `Failed to create entity relationship for "${entity.name}":`,
        error,
      );
      errors.push({
        type: "entity_relationship",
        message: error instanceof Error ? error.message : String(error),
        conversationId: conversationId.toString(),
        entity: entity.name,
      });
    }
  }

  return result;
}

export async function createTagRelationships(
  objects: (input: any) => Promise<any>,
  conversationId: ObjectId,
  tagNames: string[],
  tagsByName: Map<string, ObjectId>,
  errors: ConversationError[],
  generatedWith: Record<string, unknown>,
): Promise<{ created: number; failed: number }> {
  const result = { created: 0, failed: 0 };
  for (const tagName of tagNames) {
    const tagId = tagsByName.get(tagName);
    if (!tagId) continue;
    try {
      await objects({
        action: "create",
        object: {
          isRelationship: true,
          name: "tagged",
          relationship: {
            subject: conversationId,
            object: tagId,
            symmetrical: false,
          },
          metadata: { generatedWith },
        },
      });
      result.created++;
    } catch (error) {
      result.failed++;
      errors.push({
        type: "tag_relationship",
        message: error instanceof Error ? error.message : String(error),
        conversationId: conversationId.toString(),
        entity: tagName,
      });
    }
  }
  return result;
}

// ============================================================================
// Idempotency
// ============================================================================

export async function deleteConversationsForChunk(
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
