import { callResource } from "@/lib/api";

export type RagSearchMode = "hybrid" | "semantic" | "lexical";
export type RagCheckpointState =
  | "disabled"
  | "watching"
  | "retrying"
  | "error";

export type RagResourceErrorPayload = {
  code?: string;
  message: string;
  status?: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export class RagResourceError extends Error {
  code?: string;
  status?: number;
  retryable?: boolean;
  degraded: boolean;

  constructor(
    payload: RagResourceErrorPayload,
    options: { degraded?: boolean } = {},
  ) {
    super(payload.message);
    this.name = "RagResourceError";
    this.code = payload.code;
    this.status = payload.status;
    this.retryable = payload.retryable;
    this.degraded = options.degraded ?? false;
  }
}

export type RagSourceRef = {
  collection?: string;
  kind?: string;
  sourceId?: string;
  representation?: string;
  chunk?: number | string;
  canonicalUri?: string;
  start?: string;
  end?: string;
  speaker?: string;
  platform?: string;
  revision?: string | number;
};

export type RagScoreBreakdown = {
  dense?: number;
  sparse?: number;
  fused?: number;
  reranker?: number;
};

export type RagSearchResult = {
  evidenceId?: string;
  pointId?: string;
  id?: string;
  score: number;
  text: string;
  title?: string;
  kind?: string;
  sourceId?: string;
  collection?: string;
  canonicalUri?: string;
  occurredAt?: string;
  generation?: string;
  representation?: string;
  sourceRefs?: RagSourceRef[];
  scores?: RagScoreBreakdown;
  source?: {
    kind: string;
    collection: string;
    id: string;
    uri: string;
    title?: string;
    start?: string;
    end?: string;
    platform?: string;
    senderId?: string;
    groupId: string;
    sourceHash: string;
  };
  chunk?: {
    index: number;
    contentHash: string;
  };
};

export type RagSearchResponse = {
  success?: true;
  results: RagSearchResult[];
  requestedMode?: RagSearchMode;
  mode?: RagSearchMode;
  degraded?: boolean;
  warning?: string;
  warnings?: string[];
  tookMs?: number;
  projectionFingerprint?: string;
  projectionId?: string;
  freshness: {
    lifecycleState: string;
    checkpointState: RagCheckpointState;
    checkpointAt: string | null;
    lagSeconds: number | null;
    paused: boolean;
  };
  revalidation: {
    state: "verified" | "degraded";
    checkedSources: number;
    droppedCandidates: number;
    staleCandidates: number;
    filterRefinedCandidates: number;
  };
  selection: {
    candidateCount: number;
    verifiedCandidates: number;
    returnedCount: number;
    distinctSources: number;
    distinctGroups: number;
    maxPerSource: number;
  };
};

export type RagExactSource = {
  collection:
    | "transcriptions"
    | "messages"
    | "objects"
    | "media_visual_descriptions";
  id: string;
};

export type RagSearchRequest = {
  query: string;
  mode: RagSearchMode;
  kinds?: string[];
  start?: string;
  end?: string;
  limit: number;
  minScore?: number;
  platforms?: string[];
  senderIds?: string[];
  sources?: RagExactSource[];
  maxPerSource?: number;
};

export type RagProgress = {
  phase?: string;
  processed?: number;
  total?: number;
  percent?: number;
  currentSource?: string;
  startedAt?: string;
  updatedAt?: string | null;
  processedSources?: number;
  totalSources?: number | null;
  indexedChunks?: number;
  deletedChunks?: number;
  failedSources?: number;
};

export type RagSourceCount = {
  kind: string;
  sources?: number;
  chunks?: number;
  indexed?: number;
  pending?: number;
  errors?: number;
  collection?: string;
  documents?: number;
  indexedDocuments?: number;
  lastCheckpoint?: string | null;
  highWatermark?: string | null;
  lastReconciledAt?: string | null;
  lagSeconds?: number | null;
  error?: string | null;
  changeStream?: {
    state?: string;
    resumeTokenPresent?: boolean;
    updatedAt?: string | null;
    lagSeconds?: number | null;
    error?: string | null;
  };
};

export type RagStatusError = {
  code?: string;
  message: string;
  at?: string;
  kind?: string;
  sourceId?: string;
  retryable?: boolean;
};

export type RagProjectionStatus = {
  id?: string;
  generation?: string;
  fingerprint?: string;
  collection?: string;
  alias?: string;
  embeddingModel?: string;
  embeddingFingerprint?: string;
  chunkerFingerprint?: string;
  chunkerVersion?: string;
  vectorSize?: number;
  collectionName?: string;
  state?: string;
  denseModel?: string;
  denseDimensions?: number;
  sparseModel?: string;
  sourceSchemaFingerprint?: string;
  modelFingerprint?: string;
  inferenceContract?: RagProjectionInferenceContract | null;
  createdAt?: string;
  buildStartedAt?: string;
  activatedAt?: string | null;
  supersededAt?: string | null;
  error?: string | null;
};

export type RagEncoderContract = {
  provider: string;
  model: string;
  modelRevision: string;
  artifactRepo: string;
  tokenizer: {
    id: string;
    revision: string;
  };
  instructions: {
    document: {
      id: string;
      fingerprint: string;
    };
    query: {
      id: string;
      fingerprint: string;
    };
  };
  dimensions: number | null;
  normalization: "l2" | "none";
  options: Record<string, string | number | boolean | null>;
};

export type RagEmbeddingContract = {
  dense: RagEncoderContract;
  sparse: RagEncoderContract;
};

export type RagProjectionInferenceContract = RagEmbeddingContract & {
  profileId: string;
  contractVersion: 1;
};

export type RagRerankerStatus = {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  modelRevision: string | null;
};

export type RagInferenceStatus = {
  profileId: string;
  contractVersion: 1;
  embeddingSpaceFingerprint: string;
  activeProjectionCompatible: boolean | null;
  executor: {
    kind: "local" | "remote";
    label: string;
    transport: "in_process" | "http";
    denseLoaded: boolean | null;
    sparseLoaded: boolean | null;
    remoteExecutor: {
      label: string;
    } | null;
  };
  contract: RagEmbeddingContract;
  reranker: RagRerankerStatus;
};

export type RagStatus = {
  success?: true;
  available?: boolean;
  degraded?: boolean;
  paused?: boolean;
  lifecycle?: string;
  state?: string;
  authMode?: string;
  warnings?: string[];
  activeProjectionId?: string | null;
  projection?: RagProjectionStatus | null;
  candidateProjection?: RagProjectionStatus | null;
  inference?: RagInferenceStatus;
  progress?: RagProgress;
  counts?: {
    sources?: number;
    chunks?: number;
    points?: number;
    pending?: number;
    deleted?: number;
  };
  sourceCounts?: RagSourceCount[] | Record<string, number | RagSourceCount>;
  sources?: RagSourceCount[];
  lag?: {
    seconds?: number;
    pendingEvents?: number;
    checkpointAt?: string;
    latestSourceAt?: string;
  };
  errors?: RagStatusError[];
  updatedAt?: string;
  lastReconciledAt?: string;
  service?: {
    status?: string;
    version?: string;
    qdrant?: string;
  };
  qdrant?: {
    status?: string;
    healthy?: boolean;
    reachable?: boolean;
    version?: string;
    collectionName?: string;
    collection?: string | null;
    points?: number;
    pointsCount?: number | null;
    vectorsCount?: number;
    indexedVectorsCount?: number | null;
    error?: string | null;
    capabilities?: {
      dense?: boolean;
      sparse?: boolean;
      hybridRrf?: boolean;
      filters?: boolean;
    };
  };
  operation?: {
    id?: string;
    type?: string;
    state?: string;
    reason?: string;
    startedAt?: string;
    updatedAt?: string;
    finishedAt?: string;
    error?: string;
  } | null;
};

export type RagChunk = {
  pointId?: string;
  id?: string;
  kind?: string;
  sourceId?: string;
  text: string;
  canonicalUri?: string;
  representation?: string;
  chunkIndex?: number | string;
  revision?: string | number;
  contentHash?: string;
  occurredAt?: string;
  updatedAt?: string;
  generation?: string;
  source?: {
    kind: string;
    collection: string;
    id: string;
    uri: string;
    title?: string;
    start?: string;
    end?: string;
    platform?: string;
    senderId?: string;
    groupId?: string;
    sourceHash?: string;
  };
  chunk?: {
    index: number;
    contentHash: string;
  };
};

export type RagChunksResponse = {
  success?: true;
  chunks?: RagChunk[];
  items?: RagChunk[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  projectionId: string;
};

export type RagAcceptedOperationResponse = {
  accepted: true;
  operation: {
    id: string;
    type: string;
    state: string;
    reason?: string;
    createdAt: string;
  };
};

export type RagPauseResponse = {
  state: string;
  paused: boolean;
};

type RagFailure = {
  success: false;
  degraded?: boolean;
  error?: RagResourceErrorPayload | string;
};

function isFailure(value: unknown): value is RagFailure {
  return Boolean(
    value && typeof value === "object" &&
      (value as { success?: unknown }).success === false,
  );
}

function unwrap<T>(value: unknown): T {
  if (isFailure(value)) {
    const rawError = value.error;
    const error = typeof rawError === "string"
      ? { message: rawError }
      : rawError ?? { message: "The knowledge index request failed" };
    throw new RagResourceError(error, { degraded: value.degraded });
  }

  if (
    value && typeof value === "object" && "data" in value &&
    (value as { data?: unknown }).data != null
  ) {
    return (value as { data: T }).data;
  }

  return value as T;
}

async function callRag<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = signal
    ? await callResource("rag", body, { signal })
    : await callResource("rag", body);
  return unwrap<T>(response);
}

export const ragApi = {
  status: (signal?: AbortSignal) =>
    callRag<RagStatus>({ action: "status" }, signal),

  search: (request: RagSearchRequest, signal?: AbortSignal) =>
    callRag<RagSearchResponse>({
      action: "search",
      query: request.query,
      mode: request.mode,
      ...(request.kinds?.length ? { kinds: request.kinds } : {}),
      ...(request.start ? { start: request.start } : {}),
      ...(request.end ? { end: request.end } : {}),
      limit: request.limit,
      ...(request.minScore != null ? { minScore: request.minScore } : {}),
      ...(request.platforms?.length ? { platforms: request.platforms } : {}),
      ...(request.senderIds?.length ? { senderIds: request.senderIds } : {}),
      ...(request.sources?.length ? { sources: request.sources } : {}),
      maxPerSource: request.maxPerSource ?? 2,
    }, signal),

  listChunks: (
    request: {
      kind?: string;
      sourceId?: string;
      limit: number;
      offset: number;
    },
    signal?: AbortSignal,
  ) =>
    callRag<RagChunksResponse>({
      action: "listChunks",
      ...(request.kind ? { kind: request.kind } : {}),
      ...(request.sourceId ? { sourceId: request.sourceId } : {}),
      limit: request.limit,
      offset: request.offset,
    }, signal),

  rebuild: (reason?: string) =>
    callRag<RagAcceptedOperationResponse>({
      action: "rebuild",
      ...(reason ? { reason } : {}),
    }),

  reconcile: () =>
    callRag<RagAcceptedOperationResponse>({ action: "reconcile" }),

  pause: () => callRag<RagPauseResponse>({ action: "pause" }),

  resume: () => callRag<RagPauseResponse>({ action: "resume" }),
};

export function ragErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The knowledge index request failed";
}

export function ragChunks(response: RagChunksResponse): RagChunk[] {
  return response.chunks ?? response.items ?? [];
}

export function normalizeSourceCounts(
  sourceCounts: RagStatus["sourceCounts"],
): RagSourceCount[] {
  if (!sourceCounts) return [];
  if (Array.isArray(sourceCounts)) return sourceCounts;
  return Object.entries(sourceCounts).map(([kind, value]) =>
    typeof value === "number"
      ? { kind, chunks: value }
      : { ...value, kind: value.kind || kind }
  );
}

export function ragCanonicalRoute(
  uri: string,
  source: { start?: string; end?: string } = {},
): string | null {
  if (uri.startsWith("/")) return uri;
  if (!uri.startsWith("mycelia://")) return null;

  const path = uri.slice("mycelia://".length);
  const [namespace, ...parts] = path.split("/").filter(Boolean);
  if (namespace === "objects" && parts[0]) {
    return `/objects/${encodeURIComponent(parts[0])}`;
  }
  if (namespace === "media" && parts[0] === "assets" && parts[1]) {
    return `/media?assetId=${encodeURIComponent(parts[1])}`;
  }
  if (namespace === "media") return "/media";
  if (namespace === "messages") return "/messaging";
  if (namespace === "transcriptions") {
    const params = new URLSearchParams();
    if (source.start) params.set("start", source.start);
    if (source.end) params.set("end", source.end);
    const query = params.toString();
    return query ? `/transcript?${query}` : "/transcript";
  }
  return null;
}
