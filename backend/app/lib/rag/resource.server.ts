import { z } from "zod";
import type { Auth } from "@/lib/auth/core.server.ts";
import type { Resource } from "@/lib/auth/resources.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 120_000;

const ragSourceKindSchema = z.enum([
  "transcription",
  "message",
  "object",
  "media_visual_description",
]);

const ragSourceCollectionSchema = z.enum([
  "transcriptions",
  "messages",
  "objects",
  "media_visual_descriptions",
]);

const ragExactSourceSchema = z.object({
  collection: ragSourceCollectionSchema,
  id: z.string().trim().min(1).max(500),
}).strict();

const ragSearchRequestSchema = z.object({
  action: z.literal("search").describe(
    "Search current Mycelia facts with hybrid dense, sparse, and lexical retrieval.",
  ),
  query: z.string().trim().min(1).max(4_000).describe(
    "Natural-language fact or topic to find in the current Mycelia projection.",
  ),
  mode: z.enum(["hybrid", "semantic", "lexical"]).default("hybrid")
    .describe("Retrieval mode. Hybrid is the recommended default."),
  kinds: z.array(ragSourceKindSchema).min(1).max(20).optional().describe(
    "Optional source kinds to include.",
  ),
  start: z.string().datetime({ offset: true }).optional().describe(
    "Optional inclusive source-time lower bound (ISO 8601).",
  ),
  end: z.string().datetime({ offset: true }).optional().describe(
    "Optional inclusive source-time upper bound (ISO 8601).",
  ),
  limit: z.number().int().min(1).max(50).default(10),
  minScore: z.number().finite().nonnegative().optional(),
  platforms: z.array(z.string().trim().min(1).max(100)).min(1).max(20)
    .optional()
    .describe(
      "Exact canonical platform identifiers. Sources without a platform do not match.",
    ),
  senderIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100)
    .optional()
    .describe(
      "Exact canonical messages.senderId values. Non-message sources do not match.",
    ),
  sources: z.array(ragExactSourceSchema).min(1).max(100).optional().describe(
    "Optional exact canonical collection/source ID allow-list.",
  ),
  maxPerSource: z.number().int().min(1).max(10).default(2).describe(
    "Deterministic cap per conversation, recording, or canonical source.",
  ),
}).strict();

const ragStatusRequestSchema = z.object({
  action: z.literal("status").describe(
    "Inspect RAG projection, indexing progress, source coverage, and Qdrant health.",
  ),
}).strict();

const ragListChunksRequestSchema = z.object({
  action: z.literal("listChunks").describe(
    "Inspect indexed chunks and their canonical Mycelia sources.",
  ),
  kind: ragSourceKindSchema.optional(),
  sourceId: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
}).strict();

const ragRebuildRequestSchema = z.object({
  action: z.literal("rebuild").describe(
    "Build a new immutable RAG projection and activate it when complete.",
  ),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

const ragReconcileRequestSchema = z.object({
  action: z.literal("reconcile").describe(
    "Incrementally reconcile the active RAG projection with current Mycelia data.",
  ),
}).strict();

const ragPauseRequestSchema = z.object({
  action: z.literal("pause").describe(
    "Pause RAG indexing without deleting the active searchable projection.",
  ),
}).strict();

const ragResumeRequestSchema = z.object({
  action: z.literal("resume").describe(
    "Resume paused RAG indexing.",
  ),
}).strict();

export const ragRequestSchema = z.discriminatedUnion("action", [
  ragSearchRequestSchema,
  ragStatusRequestSchema,
  ragListChunksRequestSchema,
  ragRebuildRequestSchema,
  ragReconcileRequestSchema,
  ragPauseRequestSchema,
  ragResumeRequestSchema,
]);

export type RagRequest = z.infer<typeof ragRequestSchema>;

// Kept response-only until auth-aware ownership is introduced. Clients can
// inspect a future scope but cannot submit/spoof it in any RAG request.
const ownerScopeSchema = z.record(z.string(), z.unknown());

const ragSourceReferenceSchema = z.object({
  kind: ragSourceKindSchema,
  collection: z.string(),
  id: z.string(),
  uri: z.string(),
  title: z.string().nullish(),
  start: z.string().nullish(),
  end: z.string().nullish(),
  platform: z.string().nullish(),
  senderId: z.string().nullish(),
  groupId: z.string(),
  sourceHash: z.string(),
  ownerScope: ownerScopeSchema.optional(),
}).passthrough();

const ragChunkReferenceSchema = z.object({
  index: z.number().int().min(0),
  contentHash: z.string(),
}).passthrough();

const ragChunkSchema = z.object({
  pointId: z.string(),
  text: z.string(),
  source: ragSourceReferenceSchema,
  chunk: ragChunkReferenceSchema,
}).passthrough();

const ragSearchResultSchema = ragChunkSchema.extend({
  evidenceId: z.string(),
  score: z.number(),
}).passthrough();

export const ragSearchResponseSchema = z.object({
  projectionId: z.string(),
  mode: z.enum(["hybrid", "semantic", "lexical"]),
  tookMs: z.number().nonnegative(),
  degraded: z.boolean(),
  warnings: z.array(z.string()),
  freshness: z.object({
    lifecycleState: z.string(),
    checkpointState: z.enum(["disabled", "watching", "retrying", "error"]),
    checkpointAt: z.string().nullish(),
    lagSeconds: z.number().nonnegative().nullish(),
    paused: z.boolean(),
  }).passthrough(),
  revalidation: z.object({
    state: z.enum(["verified", "degraded"]),
    checkedSources: z.number().int().nonnegative(),
    droppedCandidates: z.number().int().nonnegative(),
    staleCandidates: z.number().int().nonnegative(),
    filterRefinedCandidates: z.number().int().nonnegative(),
  }).passthrough(),
  selection: z.object({
    candidateCount: z.number().int().nonnegative(),
    verifiedCandidates: z.number().int().nonnegative(),
    returnedCount: z.number().int().nonnegative(),
    distinctSources: z.number().int().nonnegative(),
    distinctGroups: z.number().int().nonnegative(),
    maxPerSource: z.number().int().min(1).max(10),
  }).passthrough(),
  results: z.array(ragSearchResultSchema),
}).passthrough();

export const ragChunksResponseSchema = z.object({
  projectionId: z.string(),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  items: z.array(ragChunkSchema),
}).passthrough();

const ragProjectionSchema = z.object({
  id: z.string(),
  state: z.enum([
    "building",
    "catching_up",
    "ready",
    "superseded",
    "error",
  ]),
  fingerprint: z.string(),
  generation: z.string(),
  collectionName: z.string(),
  createdAt: z.string(),
  buildStartedAt: z.string(),
  activatedAt: z.string().nullish(),
  supersededAt: z.string().nullish(),
  sourceSchemaFingerprint: z.string(),
  denseModel: z.string(),
  denseDimensions: z.number().int().positive(),
  sparseModel: z.string(),
  chunkerVersion: z.string(),
  chunkerFingerprint: z.string(),
  modelFingerprint: z.string(),
  error: z.string().nullish(),
  ownerScope: ownerScopeSchema.optional(),
}).passthrough();

const ragStatusOperationSchema = z.object({
  id: z.string(),
  type: z.string(),
  state: z.string(),
  reason: z.string().nullish(),
  projectionId: z.string().nullish(),
  createdAt: z.string(),
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish(),
  error: z.string().nullish(),
}).passthrough();

const ragProgressSchema = z.object({
  phase: z.string(),
  processedSources: z.number().int().nonnegative(),
  totalSources: z.number().int().nonnegative().nullish(),
  indexedChunks: z.number().int().nonnegative(),
  deletedChunks: z.number().int().nonnegative(),
  failedSources: z.number().int().nonnegative(),
  updatedAt: z.string().nullish(),
}).passthrough();

const ragStatusSourceSchema = z.object({
  kind: ragSourceKindSchema,
  collection: z.string(),
  documents: z.number().int().nonnegative(),
  indexedDocuments: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  highWatermark: z.string().nullish(),
  lastReconciledAt: z.string().nullish(),
  lagSeconds: z.number().nonnegative().nullish(),
  error: z.string().nullish(),
  changeStream: z.object({
    state: z.enum(["disabled", "watching", "retrying", "error"]),
    resumeTokenPresent: z.boolean(),
    updatedAt: z.string().nullish(),
    lagSeconds: z.number().nonnegative().nullish(),
    error: z.string().nullish(),
  }).passthrough(),
  ownerScope: ownerScopeSchema.optional(),
}).passthrough();

const ragQdrantStatusSchema = z.object({
  reachable: z.boolean(),
  collection: z.string().nullish(),
  pointsCount: z.number().int().nonnegative().nullish(),
  indexedVectorsCount: z.number().int().nonnegative().nullish(),
  status: z.string().nullish(),
  error: z.string().nullish(),
  capabilities: z.object({
    dense: z.boolean(),
    sparse: z.boolean(),
    hybridRrf: z.boolean(),
    filters: z.boolean(),
  }).passthrough(),
}).passthrough();

export const ragStatusResponseSchema = z.object({
  state: z.enum([
    "empty",
    "building",
    "catching_up",
    "reconciling",
    "ready",
    "paused",
    "degraded",
    "error",
  ]),
  paused: z.boolean(),
  degraded: z.boolean(),
  activeProjectionId: z.string().nullish(),
  projection: ragProjectionSchema.nullable(),
  candidateProjection: ragProjectionSchema.nullable(),
  operation: ragStatusOperationSchema.nullable(),
  progress: ragProgressSchema,
  sources: z.array(ragStatusSourceSchema),
  qdrant: ragQdrantStatusSchema,
  authMode: z.string(),
  warnings: z.array(z.string()),
}).passthrough();

export const ragAcceptedOperationResponseSchema = z.object({
  accepted: z.literal(true),
  operation: ragStatusOperationSchema,
}).passthrough();

export const ragPauseResponseSchema = z.object({
  state: z.string(),
  paused: z.boolean(),
}).passthrough();

const ragProxyErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  status: z.number().int().optional(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
});

export const ragFailureResponseSchema = z.object({
  success: z.literal(false),
  degraded: z.literal(true),
  error: ragProxyErrorSchema,
  // Search failures include these fields so an LLM cannot mistake an empty
  // vector result set for an authoritative "no matches" answer.
  warnings: z.array(z.string()).optional(),
  results: z.array(z.never()).optional(),
});

export const ragResponseSchema = z.union([
  ragSearchResponseSchema,
  ragStatusResponseSchema,
  ragChunksResponseSchema,
  ragAcceptedOperationResponseSchema,
  ragPauseResponseSchema,
  ragFailureResponseSchema,
]);

export type RagResponse = z.infer<typeof ragResponseSchema>;

type RagFailure = z.infer<typeof ragFailureResponseSchema>;
type FetchLike = typeof fetch;

export interface RagResourceOptions {
  baseUrl?: string | null;
  internalToken?: string | null;
  requestTimeoutMs?: number;
  fetch?: FetchLike;
}

function configuredTimeout(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_REQUEST_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(
    MAX_REQUEST_TIMEOUT_MS,
    Math.max(MIN_REQUEST_TIMEOUT_MS, Math.round(parsed)),
  );
}

function runtimeErrorDetails(
  value: unknown,
): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as { error?: { details?: unknown } }).error?.details;
}

function runtimeErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const code = (value as { error?: { code?: unknown } }).error?.code;
  return typeof code === "string" ? code : undefined;
}

function runtimeErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = (value as { error?: { message?: unknown } }).error?.message;
  return typeof message === "string" ? message : undefined;
}

export class RagResource implements Resource<RagRequest, RagResponse> {
  code = "rag";
  description =
    "Manage and search the standalone Qdrant-backed Mycelia RAG projection.";

  schemas = {
    request: ragRequestSchema as z.ZodType<RagRequest>,
    response: ragResponseSchema as z.ZodType<RagResponse>,
  };

  private readonly baseUrl: string;
  private readonly internalToken?: string;
  private readonly requestTimeoutMs: number;
  private readonly fetcher: FetchLike;

  constructor(options: RagResourceOptions = {}) {
    this.baseUrl =
      (options.baseUrl === undefined
        ? Deno.env.get("RAG_URL")
        : options.baseUrl)?.trim().replace(/\/+$/, "") ?? "";
    this.internalToken =
      (options.internalToken === undefined
        ? Deno.env.get("RAG_INTERNAL_TOKEN")
        : options.internalToken)?.trim() || undefined;
    this.requestTimeoutMs = options.requestTimeoutMs ?? configuredTimeout(
      Deno.env.get("RAG_REQUEST_TIMEOUT_MS"),
    );
    this.fetcher = options.fetch ?? fetch;
  }

  extractActions(input: RagRequest) {
    switch (input.action) {
      case "search":
        return [{ path: ["rag", "search"], actions: ["read"] }];
      case "status":
        return [{ path: ["rag", "status"], actions: ["read"] }];
      case "listChunks":
        return [{ path: ["rag", "chunks"], actions: ["read"] }];
      case "rebuild":
      case "reconcile":
      case "pause":
      case "resume":
        return [{
          path: ["rag", "index", input.action],
          actions: ["write", "control"],
        }];
    }
  }

  async use(input: RagRequest, _auth: Auth): Promise<RagResponse> {
    switch (input.action) {
      case "status":
        return await this.request(
          input.action,
          "GET",
          "/v1/status",
          ragStatusResponseSchema,
        );
      case "search": {
        const { action: _action, ...body } = input;
        return await this.request(
          input.action,
          "POST",
          "/v1/search",
          ragSearchResponseSchema,
          body,
        );
      }
      case "listChunks": {
        const params = new URLSearchParams({
          limit: String(input.limit),
          offset: String(input.offset),
        });
        if (input.kind) params.set("kind", input.kind);
        if (input.sourceId) params.set("sourceId", input.sourceId);
        return await this.request(
          input.action,
          "GET",
          `/v1/chunks?${params.toString()}`,
          ragChunksResponseSchema,
        );
      }
      case "rebuild": {
        const body = input.reason ? { reason: input.reason } : {};
        return await this.request(
          input.action,
          "POST",
          "/v1/index/rebuild",
          ragAcceptedOperationResponseSchema,
          body,
        );
      }
      case "reconcile":
        return await this.request(
          input.action,
          "POST",
          "/v1/index/reconcile",
          ragAcceptedOperationResponseSchema,
          {},
        );
      case "pause":
        return await this.request(
          input.action,
          "POST",
          "/v1/index/pause",
          ragPauseResponseSchema,
          {},
        );
      case "resume":
        return await this.request(
          input.action,
          "POST",
          "/v1/index/resume",
          ragPauseResponseSchema,
          {},
        );
    }
  }

  private failure(
    action: RagRequest["action"],
    code: string,
    message: string,
    options: {
      status?: number;
      retryable?: boolean;
      details?: unknown;
    } = {},
  ): RagFailure {
    return {
      success: false,
      degraded: true,
      error: {
        code,
        message,
        status: options.status,
        retryable: options.retryable ?? false,
        details: options.details,
      },
      ...(action === "search"
        ? {
          warnings: [
            `RAG search is unavailable: ${message}. Do not interpret this as an empty result set.`,
          ],
          results: [],
        }
        : {}),
    };
  }

  private async request<T extends RagResponse>(
    action: RagRequest["action"],
    method: "GET" | "POST",
    path: string,
    responseSchema: z.ZodType<T>,
    body?: Record<string, unknown>,
  ): Promise<T | RagFailure> {
    if (!this.baseUrl) {
      return this.failure(
        action,
        "rag_not_configured",
        "RAG_URL is not configured",
      );
    }

    let url: URL;
    try {
      url = new URL(path, `${this.baseUrl}/`);
    } catch {
      return this.failure(
        action,
        "rag_invalid_configuration",
        "RAG_URL is not a valid absolute URL",
      );
    }

    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (this.internalToken) {
      headers.set("Authorization", `Bearer ${this.internalToken}`);
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failure(
        action,
        error instanceof DOMException && error.name === "TimeoutError"
          ? "rag_timeout"
          : "rag_unavailable",
        message || "RAG runtime is unavailable",
        { retryable: true },
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failure(
        action,
        "rag_unavailable",
        message || "Could not read the RAG runtime response body",
        { status: response.status, retryable: true },
      );
    }
    let payload: unknown;
    try {
      payload = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      return this.failure(
        action,
        "rag_invalid_json",
        `RAG runtime returned invalid JSON (HTTP ${response.status})`,
        { status: response.status, retryable: response.status >= 500 },
      );
    }

    if (!response.ok) {
      return this.failure(
        action,
        runtimeErrorCode(payload) ?? "rag_http_error",
        runtimeErrorMessage(payload) ??
          `RAG runtime returned HTTP ${response.status}`,
        {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          details: runtimeErrorDetails(payload),
        },
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      return this.failure(
        action,
        "rag_invalid_response",
        "RAG runtime response does not match the expected contract",
        {
          status: response.status,
          details: { issues: parsed.error.issues },
        },
      );
    }

    return parsed.data;
  }
}
