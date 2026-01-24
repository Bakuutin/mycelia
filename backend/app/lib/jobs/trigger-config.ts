import { env } from "#/env.ts";

// Default values (production)
const DEFAULTS = {
  vad: { debounceMs: 1000, interval: 300 },
  transcription_sequence_creator: { debounceMs: 1000, interval: 300 },
  transcription: { debounceMs: 5000, interval: 300 },
  conversation_chunk_creator: { debounceMs: 2000, interval: 30 },
  conversation_extractor: { debounceMs: 5000, interval: 300 },
} as const;

// Fast mode values (for testing)
// Relies on change stream events + hasMore re-enqueue for job chaining
const FAST = {
  vad: { debounceMs: 500, interval: 0 },
  transcription_sequence_creator: { debounceMs: 500, interval: 0 },
  transcription: { debounceMs: 1000, interval: 0 },
  conversation_chunk_creator: { debounceMs: 500, interval: 30 }, // Needs polling to finalize stale chunks
  conversation_extractor: { debounceMs: 1000, interval: 0 },
} as const;

type WorkerName = keyof typeof DEFAULTS;

export interface TriggerTiming {
  debounceMs: number;
  interval: number;
}

/**
 * Get trigger timing configuration for a worker.
 *
 * Configuration priority:
 * 1. JOB_DEBOUNCE_MS / JOB_INTERVAL_SECONDS env vars (explicit override)
 * 2. JOB_TRIGGERS_FAST=true (use fast preset)
 * 3. Default production values
 */
export function getTriggerTiming(workerName: WorkerName): TriggerTiming {
  const defaults = DEFAULTS[workerName];
  const fast = FAST[workerName];

  // Check for explicit overrides
  if (env.JOB_DEBOUNCE_MS !== undefined || env.JOB_INTERVAL_SECONDS !== undefined) {
    return {
      debounceMs: env.JOB_DEBOUNCE_MS ?? defaults.debounceMs,
      interval: env.JOB_INTERVAL_SECONDS ?? defaults.interval,
    };
  }

  // Check for fast mode
  if (env.JOB_TRIGGERS_FAST) {
    return fast;
  }

  // Return defaults
  return defaults;
}
