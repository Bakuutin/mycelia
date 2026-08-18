export function createSingleFlightBackoff<T>(options: {
  backoffMs: number;
  isDeadlineError: (error: unknown) => boolean;
  now?: () => number;
}) {
  const inFlight = new Map<string, Promise<T>>();
  const retryAfter = new Map<string, number>();
  const now = options.now ?? Date.now;

  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const currentTime = now();
    const blockedUntil = retryAfter.get(key) ?? 0;
    if (blockedUntil > currentTime) {
      throw new Error(
        `Query is in timeout backoff until ${
          new Date(blockedUntil).toISOString()
        }`,
      );
    }
    if (blockedUntil > 0) retryAfter.delete(key);

    const existing = inFlight.get(key);
    if (existing) return await existing;

    const request = load()
      .catch((error) => {
        if (options.isDeadlineError(error)) {
          retryAfter.set(key, now() + options.backoffMs);
        }
        throw error;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return await request;
  };
}
