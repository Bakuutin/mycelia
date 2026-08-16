export type CanonicalJobState =
  | "active"
  | "waiting"
  | "delayed"
  | "completed"
  | "failed";

export function canonicalQueueJobState(
  queueState: string | undefined,
): CanonicalJobState | undefined {
  switch (queueState) {
    case "active":
    case "delayed":
    case "completed":
    case "failed":
      return queueState;
    case "waiting":
    case "paused":
    case "prioritized":
    case "waiting-children":
      return "waiting";
    default:
      return undefined;
  }
}

export function resolveLiveJobState(
  persistedState: string,
  queueState: string | undefined,
): string {
  return canonicalQueueJobState(queueState) ?? persistedState;
}
