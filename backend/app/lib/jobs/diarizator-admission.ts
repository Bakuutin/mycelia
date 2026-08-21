import type { JobData } from "./types.ts";

export const DIARIZATOR_WAITING_FOR_SLOT = "waiting_for_diarizator_slot";

/**
 * Shared ordering for every job type that uses the diarizator pool. BullMQ
 * queues are per job type, so this priority is also persisted for the common
 * admission reconciler.
 */
export function getDiarizatorAdmissionPriority(
  data: JobData,
  explicit?: number,
): number {
  if (data.type === "profileReenrollment" || data.type === "enrollment") {
    return 1;
  }
  if (data.type === "diarization" && data.originalId) return 5;
  if (data.type === "diarization" && data.mode === "build_generation") {
    return 15;
  }
  if (Number.isFinite(explicit)) return Number(explicit);
  return 20;
}

export function isDiarizatorSlotUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(
    "All healthy diarizator provider concurrency slots are reserved",
  ) || message.includes("has no free concurrency slots");
}
