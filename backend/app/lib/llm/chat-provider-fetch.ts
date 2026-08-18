const DEFAULT_LOADING_RETRY_DELAYS_MS = [
  2_000,
  5_000,
  10_000,
  20_000,
  30_000,
  30_000,
];
const DEFAULT_EMPTY_RETRY_DELAYS_MS = [1_000, 3_000];
const DEFAULT_TRANSIENT_RETRY_DELAYS_MS = [1_000, 2_000];
const MAX_BUFFERED_STREAM_PREFIX_BYTES = 1024 * 1024;

type FetchLike = typeof fetch;

type ChatProviderFetchOptions = {
  requestId: string;
  providerName: string;
  model: string;
  fetch?: FetchLike;
  sleep?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>;
  loadingRetryDelaysMs?: number[];
  emptyRetryDelaysMs?: number[];
  transientRetryDelaysMs?: number[];
};

type StreamInspection =
  | { kind: "usable"; response: Response }
  | { kind: "loading" }
  | { kind: "empty" };

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

function getErrorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  return getErrorText(record.error) || getErrorText(record.detail);
}

function isLoadingModelText(value: string): boolean {
  return /\bloading\s+(?:the\s+)?model\b/i.test(value);
}

async function responseMentionsLoadingModel(
  response: Response,
): Promise<boolean> {
  try {
    const text = await response.clone().text();
    if (isLoadingModelText(text)) return true;
    try {
      return isLoadingModelText(getErrorText(JSON.parse(text)));
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function inspectOpenAiSsePrefix(
  text: string,
): "pending" | "loading" | "meaningful" {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const event = JSON.parse(payload) as Record<string, unknown>;
      if (event.error) {
        if (isLoadingModelText(getErrorText(event.error))) return "loading";
        continue;
      }
      const choices = Array.isArray(event.choices) ? event.choices : [];
      for (const choice of choices) {
        if (!choice || typeof choice !== "object") continue;
        const choiceRecord = choice as Record<string, unknown>;
        const candidate = (choiceRecord.delta ?? choiceRecord.message) as
          | Record<string, unknown>
          | undefined;
        if (!candidate) continue;
        if (
          (typeof candidate.content === "string" &&
            candidate.content.length > 0) ||
          (Array.isArray(candidate.tool_calls) &&
            candidate.tool_calls.length > 0)
        ) {
          return "meaningful";
        }
      }
    } catch {
      // A chunk can end in the middle of an SSE event. Keep buffering until a
      // complete event arrives or the provider closes the stream.
      if (isLoadingModelText(payload)) return "loading";
    }
  }
  return "pending";
}

function rebuildResponse(
  response: Response,
  body: ReadableStream<Uint8Array>,
): Response {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function inspectSuccessfulStream(
  response: Response,
): Promise<StreamInspection> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const contentLength = response.headers.get("content-length");
    if (contentLength === "0") return { kind: "empty" };
    return { kind: "usable", response };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let prefix = "";
  let bufferedBytes = 0;

  while (bufferedBytes <= MAX_BUFFERED_STREAM_PREFIX_BYTES) {
    const { done, value } = await reader.read();
    if (done) {
      prefix += decoder.decode();
      if (inspectOpenAiSsePrefix(prefix) === "loading") {
        return { kind: "loading" };
      }
      return { kind: "empty" };
    }

    chunks.push(value);
    bufferedBytes += value.byteLength;
    prefix += decoder.decode(value, { stream: true });

    const prefixState = inspectOpenAiSsePrefix(prefix);
    if (prefixState === "loading") {
      await reader.cancel();
      return { kind: "loading" };
    }
    if (prefixState === "meaningful") break;
  }

  const replayedBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of chunks) controller.enqueue(chunk);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  return { kind: "usable", response: rebuildResponse(response, replayedBody) };
}

function parseRetryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

function abortableSleep(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function emptyProviderResponse(attempts: number): Response {
  return Response.json(
    {
      error: {
        message:
          `Provider closed the stream without text, tool calls, usage, or a finish reason after ${attempts} attempts`,
        type: "empty_provider_stream",
      },
    },
    { status: 502 },
  );
}

/**
 * Adds bounded provider-level recovery around an OpenAI-compatible chat
 * request. AI SDK retries HTTP failures, but a local model server can answer
 * with `Loading model` for longer than its default retry window, or close a
 * nominally successful SSE stream after only `[DONE]`. Both cases otherwise
 * surface as an unusable empty assistant message.
 */
export function createChatProviderFetch(
  options: ChatProviderFetchOptions,
): FetchLike {
  const baseFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  const loadingRetryDelays = options.loadingRetryDelaysMs ??
    DEFAULT_LOADING_RETRY_DELAYS_MS;
  const emptyRetryDelays = options.emptyRetryDelaysMs ??
    DEFAULT_EMPTY_RETRY_DELAYS_MS;
  const transientRetryDelays = options.transientRetryDelaysMs ??
    DEFAULT_TRANSIENT_RETRY_DELAYS_MS;

  return async (input, init) => {
    let loadingRetries = 0;
    let emptyRetries = 0;
    let transientRetries = 0;
    let attempts = 0;

    while (true) {
      attempts += 1;
      let response: Response;
      try {
        response = await baseFetch(input, init);
      } catch (error) {
        if (
          init?.signal?.aborted ||
          transientRetries >= transientRetryDelays.length
        ) {
          throw error;
        }
        const delayMs = transientRetryDelays[transientRetries++];
        console.warn("[apiChatHandler] Retrying chat provider request", {
          requestId: options.requestId,
          providerProfileName: options.providerName,
          model: options.model,
          reason: "network_error",
          attempt: attempts,
          delayMs,
        });
        await sleep(delayMs, init?.signal);
        continue;
      }

      const loading = !response.ok &&
        await responseMentionsLoadingModel(response);
      if (loading) {
        if (loadingRetries >= loadingRetryDelays.length) return response;
        const delayMs = Math.max(
          loadingRetryDelays[loadingRetries++],
          parseRetryAfterMs(response) ?? 0,
        );
        console.warn("[apiChatHandler] Waiting for chat model to load", {
          requestId: options.requestId,
          providerProfileName: options.providerName,
          model: options.model,
          attempt: attempts,
          delayMs,
          status: response.status,
        });
        await sleep(delayMs, init?.signal);
        continue;
      }

      if (response.ok) {
        let inspection: StreamInspection;
        try {
          inspection = await inspectSuccessfulStream(response);
        } catch (error) {
          // fetch() resolves as soon as response headers arrive. A remote
          // inference server can still reset the SSE body while we are
          // buffering reasoning-only events before the first visible token.
          // Treat that body-read failure like the equivalent fetch-level
          // network error so it gets the same bounded retry budget.
          if (
            init?.signal?.aborted ||
            transientRetries >= transientRetryDelays.length
          ) {
            throw error;
          }
          const delayMs = transientRetryDelays[transientRetries++];
          console.warn("[apiChatHandler] Retrying chat provider request", {
            requestId: options.requestId,
            providerProfileName: options.providerName,
            model: options.model,
            reason: "stream_read_error",
            error: getErrorText(error),
            attempt: attempts,
            delayMs,
          });
          await sleep(delayMs, init?.signal);
          continue;
        }
        if (inspection.kind === "usable") return inspection.response;
        if (inspection.kind === "loading") {
          if (loadingRetries >= loadingRetryDelays.length) {
            return emptyProviderResponse(attempts);
          }
          const delayMs = loadingRetryDelays[loadingRetries++];
          console.warn("[apiChatHandler] Waiting for chat model to load", {
            requestId: options.requestId,
            providerProfileName: options.providerName,
            model: options.model,
            attempt: attempts,
            delayMs,
            status: response.status,
          });
          await sleep(delayMs, init?.signal);
          continue;
        }

        if (emptyRetries >= emptyRetryDelays.length) {
          console.error(
            "[apiChatHandler] Provider returned empty chat streams",
            {
              requestId: options.requestId,
              providerProfileName: options.providerName,
              model: options.model,
              attempts,
            },
          );
          return emptyProviderResponse(attempts);
        }
        const delayMs = emptyRetryDelays[emptyRetries++];
        console.warn("[apiChatHandler] Retrying empty chat provider stream", {
          requestId: options.requestId,
          providerProfileName: options.providerName,
          model: options.model,
          attempt: attempts,
          delayMs,
        });
        await sleep(delayMs, init?.signal);
        continue;
      }

      if (
        RETRYABLE_HTTP_STATUSES.has(response.status) &&
        transientRetries < transientRetryDelays.length
      ) {
        const delayMs = Math.max(
          transientRetryDelays[transientRetries++],
          parseRetryAfterMs(response) ?? 0,
        );
        console.warn("[apiChatHandler] Retrying chat provider request", {
          requestId: options.requestId,
          providerProfileName: options.providerName,
          model: options.model,
          reason: `http_${response.status}`,
          attempt: attempts,
          delayMs,
        });
        await sleep(delayMs, init?.signal);
        continue;
      }

      return response;
    }
  };
}
