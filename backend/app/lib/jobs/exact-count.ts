export type ExactCountResult =
  | { value: number; status: "exact" }
  | { value: null; status: "timeout"; warning: string };

export function isMongoDeadlineError(error: unknown): boolean {
  const candidate = error as { code?: unknown; codeName?: unknown } | null;
  return candidate?.code === 50 || candidate?.codeName === "MaxTimeMSExpired" ||
    /MaxTimeMSExpired|operation exceeded time limit/i.test(String(error));
}

/**
 * Keep one slow corpus-wide count from turning an otherwise useful manual
 * pipeline snapshot into an HTTP 500. Non-deadline failures still surface.
 */
export async function runExactCount(
  load: () => Promise<unknown>,
  timeoutSeconds: number,
): Promise<ExactCountResult> {
  try {
    return { value: Number(await load()), status: "exact" };
  } catch (error) {
    if (!isMongoDeadlineError(error)) throw error;
    return {
      value: null,
      status: "timeout",
      warning:
        `Exact count exceeded its ${timeoutSeconds}-second MongoDB limit; retry the snapshot after the database load falls.`,
    };
  }
}
