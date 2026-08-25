export type DiarizationErrorRecoveryState =
  | "recovered"
  | "retrying"
  | "needs_attention"
  | "pending"
  | "unknown";

export interface DiarizationErrorOutcome {
  index: number;
  state: DiarizationErrorRecoveryState;
  matchedChunks: number;
  diarizedChunks: number;
  recoveredAt?: Date;
  currentFailure?: {
    status?: string;
    category?: string;
    message?: string;
    route?: string;
    attempt?: number;
    retryAt?: Date;
  };
}

type DiarizationError = {
  originalId?: unknown;
  start?: unknown;
  end?: unknown;
};

type DiarizationChunk = {
  original_id?: unknown;
  start?: unknown;
  diarized_at?: unknown;
  diarizationFailure?: Record<string, unknown> | null;
};

function validDate(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function currentFailureFor(
  chunks: DiarizationChunk[],
): DiarizationErrorOutcome["currentFailure"] {
  const failures = chunks
    .map((chunk) => chunk.diarizationFailure)
    .filter((value): value is Record<string, unknown> => value != null);
  if (failures.length === 0) return undefined;

  const failure = failures.sort((left, right) => {
    if (left.status === "needs_attention") return -1;
    if (right.status === "needs_attention") return 1;
    return Number(right.attempt ?? 0) - Number(left.attempt ?? 0);
  })[0];

  return {
    ...(typeof failure.status === "string" ? { status: failure.status } : {}),
    ...(typeof failure.category === "string"
      ? { category: failure.category }
      : {}),
    ...(typeof failure.message === "string"
      ? { message: failure.message }
      : {}),
    ...(typeof failure.route === "string" ? { route: failure.route } : {}),
    ...(typeof failure.attempt === "number"
      ? { attempt: failure.attempt }
      : {}),
    ...(validDate(failure.retryAt)
      ? { retryAt: validDate(failure.retryAt)! }
      : {}),
  };
}

export function deriveDiarizationErrorOutcomes(
  errors: DiarizationError[],
  chunks: DiarizationChunk[],
): DiarizationErrorOutcome[] {
  return errors.map((error, index) => {
    const originalId = typeof error.originalId === "string"
      ? error.originalId
      : null;
    const start = validDate(error.start);
    const end = validDate(error.end);
    if (!originalId || !start || !end) {
      return { index, state: "unknown", matchedChunks: 0, diarizedChunks: 0 };
    }

    const matching = chunks.filter((chunk) => {
      const chunkStart = validDate(chunk.start);
      return String(chunk.original_id ?? "") === originalId &&
        chunkStart != null &&
        chunkStart >= start &&
        chunkStart <= end;
    });
    const recoveredDates = matching
      .map((chunk) => validDate(chunk.diarized_at))
      .filter((value): value is Date => value != null);
    const currentFailure = currentFailureFor(matching);

    let state: DiarizationErrorRecoveryState = "pending";
    if (matching.length === 0) state = "unknown";
    else if (recoveredDates.length === matching.length) state = "recovered";
    else if (currentFailure?.status === "needs_attention") {
      state = "needs_attention";
    } else if (currentFailure?.status === "will_retry") {
      state = "retrying";
    }

    const recoveredAt = recoveredDates.length > 0
      ? new Date(Math.max(...recoveredDates.map((date) => date.getTime())))
      : undefined;

    return {
      index,
      state,
      matchedChunks: matching.length,
      diarizedChunks: recoveredDates.length,
      ...(recoveredAt ? { recoveredAt } : {}),
      ...(currentFailure ? { currentFailure } : {}),
    };
  });
}
