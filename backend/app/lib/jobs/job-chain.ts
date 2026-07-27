/**
 * Continue automatic batch processing only when the previous run both reports
 * more work and proves that it made progress. This prevents a worker that is
 * stuck on the same input from creating an endless sequence of jobs.
 */
export function shouldContinueJobChain(
  result: unknown,
): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  return value.hasMore === true &&
    typeof value.processed === "number" &&
    Number.isFinite(value.processed) &&
    value.processed > 0;
}
