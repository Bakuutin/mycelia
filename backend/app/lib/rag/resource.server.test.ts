import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  type RagRequest,
  ragRequestSchema,
  RagResource,
} from "./resource.server.ts";

const auth = new Auth({
  principal: "rag-test",
  policies: [{ resource: "rag/**", action: "*", effect: "allow" }],
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

async function use(
  resource: RagResource,
  input: unknown,
) {
  return await resource.use(ragRequestSchema.parse(input), auth);
}

Deno.test("RagResource proxies search with bearer auth and validates results", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const resource = new RagResource({
    baseUrl: "http://rag.example:48091/",
    internalToken: "secret-token",
    fetch: asFetch((input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Promise.resolve(jsonResponse({
        projectionId: "projection-a",
        mode: "hybrid",
        tookMs: 12,
        degraded: false,
        warnings: [],
        freshness: {
          lifecycleState: "ready",
          checkpointState: "watching",
          checkpointAt: "2026-08-26T10:00:00Z",
          lagSeconds: 0.4,
          paused: false,
        },
        revalidation: {
          state: "verified",
          checkedSources: 1,
          droppedCandidates: 0,
          staleCandidates: 0,
          filterRefinedCandidates: 0,
        },
        selection: {
          candidateCount: 1,
          verifiedCandidates: 1,
          returnedCount: 1,
          distinctSources: 1,
          distinctGroups: 1,
          maxPerSource: 3,
        },
        results: [{
          evidenceId: "projection-a:point-a:sha256-a",
          pointId: "point-a",
          score: 0.91,
          text: "The current fact",
          source: {
            kind: "object",
            collection: "objects",
            id: "object-a",
            uri: "/objects/object-a",
            title: null,
            start: null,
            end: null,
            platform: null,
            groupId: "objects:object-a",
            sourceHash: "source-hash-a",
          },
          chunk: { index: 0, contentHash: "sha256:a" },
        }],
      }));
    }),
  });

  const result = await use(resource, {
    action: "search",
    query: "current fact",
    kinds: ["object"],
    platforms: ["mycelia"],
    senderIds: ["sender-a"],
    sources: [{ collection: "objects", id: "object-a" }],
    limit: 7,
    maxPerSource: 3,
  });

  expect(capturedUrl).toBe("http://rag.example:48091/v1/search");
  expect(capturedInit?.method).toBe("POST");
  expect(new Headers(capturedInit?.headers).get("Authorization")).toBe(
    "Bearer secret-token",
  );
  expect(JSON.parse(String(capturedInit?.body))).toEqual({
    query: "current fact",
    mode: "hybrid",
    kinds: ["object"],
    platforms: ["mycelia"],
    senderIds: ["sender-a"],
    sources: [{ collection: "objects", id: "object-a" }],
    limit: 7,
    maxPerSource: 3,
  });
  expect(result).toMatchObject({
    projectionId: "projection-a",
    degraded: false,
    freshness: {
      lifecycleState: "ready",
      checkpointState: "watching",
      lagSeconds: 0.4,
    },
    results: [{
      source: { uri: "/objects/object-a", title: null, end: null },
    }],
  });
});

Deno.test("RagResource never reports unavailable search as an empty authoritative result", async () => {
  const resource = new RagResource({
    baseUrl: "http://rag.example:48091",
    fetch: asFetch(() => Promise.reject(new TypeError("connection refused"))),
  });

  const result = await use(resource, {
    action: "search",
    query: "fact",
  });

  expect(result).toMatchObject({
    success: false,
    degraded: true,
    results: [],
    error: {
      code: "rag_unavailable",
      retryable: true,
    },
  });
  expect((result as { warnings?: string[] }).warnings?.[0]).toContain(
    "Do not interpret this as an empty result set",
  );
});

Deno.test("RagResource types a broken response stream as unavailable", async () => {
  const resource = new RagResource({
    baseUrl: "http://rag.example:48091",
    fetch: asFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("broken response body"));
            },
          }),
          { status: 200 },
        ),
      )
    ),
  });

  const result = await use(resource, { action: "search", query: "fact" });

  expect(result).toMatchObject({
    success: false,
    degraded: true,
    results: [],
    error: {
      code: "rag_unavailable",
      retryable: true,
      status: 200,
    },
  });
});

Deno.test("RagResource reports disabled integration without attempting fetch", async () => {
  let called = false;
  const resource = new RagResource({
    baseUrl: "",
    fetch: asFetch(() => {
      called = true;
      return Promise.resolve(jsonResponse({}));
    }),
  });

  const result = await use(resource, { action: "status" });

  expect(called).toBe(false);
  expect(result).toMatchObject({
    success: false,
    degraded: true,
    error: { code: "rag_not_configured", retryable: false },
  });
});

Deno.test("RagResource preserves stable runtime errors as typed failures", async () => {
  const resource = new RagResource({
    baseUrl: "http://rag.example:48091",
    fetch: asFetch(() =>
      Promise.resolve(jsonResponse({
        error: {
          code: "operation_conflict",
          message: "A rebuild is already running",
          details: { operationId: "op-a" },
        },
      }, 409))
    ),
  });

  const result = await use(resource, {
    action: "rebuild",
    reason: "schema change",
  });

  expect(result).toMatchObject({
    success: false,
    degraded: true,
    error: {
      code: "operation_conflict",
      message: "A rebuild is already running",
      status: 409,
      retryable: false,
      details: { operationId: "op-a" },
    },
  });
});

Deno.test("RagResource preserves FastAPI validation detail arrays", async () => {
  const details = [{
    type: "less_than_equal",
    loc: ["body", "limit"],
    msg: "Input should be less than or equal to 50",
  }];
  const resource = new RagResource({
    baseUrl: "http://rag.example:48091",
    fetch: asFetch(() =>
      Promise.resolve(jsonResponse({
        error: {
          code: "validation_error",
          message: "request validation failed",
          details,
        },
      }, 422))
    ),
  });

  const result = await use(resource, { action: "search", query: "fact" });

  expect(result).toMatchObject({
    success: false,
    error: { code: "validation_error", details },
  });
});

Deno.test("RagResource proxies status and chunk pagination contracts", async () => {
  const urls: string[] = [];
  const resource = new RagResource({
    baseUrl: "http://rag.example:48091",
    fetch: asFetch((input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/v1/status")) {
        return Promise.resolve(jsonResponse({
          state: "catching_up",
          paused: false,
          degraded: false,
          activeProjectionId: null,
          projection: {
            id: "projection-b",
            state: "catching_up",
            fingerprint: "fingerprint-b",
            generation: "generation-b",
            collectionName: "mycelia_projection_b",
            createdAt: "2026-08-26T10:00:00Z",
            buildStartedAt: "2026-08-26T10:00:00Z",
            activatedAt: null,
            supersededAt: null,
            sourceSchemaFingerprint: "source-schema-b",
            denseModel: "dense-model",
            denseDimensions: 768,
            sparseModel: "sparse-model",
            chunkerVersion: "v1",
            chunkerFingerprint: "chunker-b",
            modelFingerprint: "model-b",
            error: null,
          },
          candidateProjection: null,
          operation: null,
          progress: {
            phase: "catch_up",
            processedSources: 12,
            totalSources: 15,
            indexedChunks: 30,
            deletedChunks: 2,
            failedSources: 0,
            updatedAt: null,
          },
          sources: [],
          qdrant: {
            reachable: true,
            capabilities: {
              dense: true,
              sparse: true,
              hybridRrf: true,
              filters: true,
            },
          },
          authMode: "internal_token",
          warnings: [],
        }));
      }
      return Promise.resolve(jsonResponse({
        projectionId: "projection-b",
        total: 1,
        limit: 25,
        offset: 50,
        items: [{
          pointId: "point-b",
          text: "Chunk",
          source: {
            kind: "message",
            collection: "messages",
            id: "message-b",
            uri: "mycelia://messages/message-b",
            platform: "telegram",
            senderId: "sender-b",
            groupId: "chat:telegram:chat-b",
            sourceHash: "source-hash-b",
          },
          chunk: { index: 1, contentHash: "sha256:b" },
        }],
      }));
    }),
  });

  const status = await use(resource, { action: "status" });
  const chunks = await use(resource, {
    action: "listChunks",
    kind: "message",
    sourceId: "message-b",
    limit: 25,
    offset: 50,
  });

  expect(status).toMatchObject({
    state: "catching_up",
    projection: { state: "catching_up" },
  });
  expect(chunks).toMatchObject({ total: 1, limit: 25, offset: 50 });
  expect(urls[1]).toBe(
    "http://rag.example:48091/v1/chunks?limit=25&offset=50&kind=message&sourceId=message-b",
  );
});

Deno.test("RagResource maps every control action to the standalone index API", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const resource = new RagResource({
    baseUrl: "http://rag.example:48091",
    fetch: asFetch((input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const isPause = String(input).endsWith("/pause");
      const isResume = String(input).endsWith("/resume");
      return Promise.resolve(
        jsonResponse(
          isPause || isResume
            ? { state: isPause ? "paused" : "ready", paused: isPause }
            : {
              accepted: true,
              operation: {
                id: "operation-a",
                type: String(input).split("/").at(-1),
                state: "queued",
                reason: null,
                projectionId: null,
                createdAt: "2026-08-26T10:00:00Z",
                startedAt: null,
                finishedAt: null,
                error: null,
              },
            },
        ),
      );
    }),
  });

  await use(resource, { action: "rebuild", reason: "manual" });
  await use(resource, { action: "reconcile" });
  await use(resource, { action: "pause" });
  await use(resource, { action: "resume" });

  expect(requests).toEqual([
    {
      url: "http://rag.example:48091/v1/index/rebuild",
      body: { reason: "manual" },
    },
    { url: "http://rag.example:48091/v1/index/reconcile", body: {} },
    { url: "http://rag.example:48091/v1/index/pause", body: {} },
    { url: "http://rag.example:48091/v1/index/resume", body: {} },
  ]);
});

Deno.test("RagResource access actions separate reads from index control", () => {
  const resource = new RagResource({ baseUrl: "" });
  const parse = (input: unknown): RagRequest => ragRequestSchema.parse(input);

  expect(resource.extractActions(parse({ action: "search", query: "x" })))
    .toEqual([{ path: ["rag", "search"], actions: ["read"] }]);
  expect(resource.extractActions(parse({ action: "status" }))).toEqual([
    { path: ["rag", "status"], actions: ["read"] },
  ]);
  expect(resource.extractActions(parse({ action: "listChunks" }))).toEqual([
    { path: ["rag", "chunks"], actions: ["read"] },
  ]);

  for (
    const action of [
      "rebuild",
      "reconcile",
      "pause",
      "resume",
    ] as const
  ) {
    expect(resource.extractActions(parse({ action }))).toEqual([{
      path: ["rag", "index", action],
      actions: ["write", "control"],
    }]);
  }
});

Deno.test("RagResource request schema rejects client-supplied ownerScope", () => {
  expect(
    ragRequestSchema.safeParse({
      action: "search",
      query: "fact",
      ownerScope: { ownerId: "spoofed" },
    }).success,
  ).toBe(false);
});

Deno.test("RagResource rejects empty exact-filter allow-lists", () => {
  for (const field of ["kinds", "platforms", "senderIds", "sources"] as const) {
    expect(
      ragRequestSchema.safeParse({
        action: "search",
        query: "fact",
        [field]: [],
      })
        .success,
    ).toBe(false);
  }
});
