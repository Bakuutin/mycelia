import type { z } from "zod";
import type {
  zTranscriptionProfilesConfig,
  zTranscriptionProviderProfile,
} from "@myceliasdk/config.ts";

export type TranscriptionProviderProfile = z.infer<
  typeof zTranscriptionProviderProfile
>;

export type TranscriptionProfilesConfig = z.infer<
  typeof zTranscriptionProfilesConfig
>;

export type TranscriptionProviderLoad = Record<string, number>;

export function getEnabledTranscriptionProfiles(
  profiles: readonly TranscriptionProviderProfile[],
): TranscriptionProviderProfile[] {
  return profiles.filter((profile) => profile.enabled);
}

export function getTranscriptionProviderCapacity(
  profiles: readonly TranscriptionProviderProfile[],
): number {
  return getEnabledTranscriptionProfiles(profiles).reduce(
    (sum, profile) => sum + profile.concurrency,
    0,
  );
}

/**
 * Select the least-loaded provider that still has a free configured slot.
 * Waiting and delayed jobs count as reserved slots so BullMQ cannot later run
 * two jobs against a provider whose profile allows only one.
 */
export function selectTranscriptionProvider(
  profiles: readonly TranscriptionProviderProfile[],
  load: TranscriptionProviderLoad,
): TranscriptionProviderProfile | null {
  const candidates = getEnabledTranscriptionProfiles(profiles)
    .filter((profile) => (load[profile.id] ?? 0) < profile.concurrency)
    .sort((a, b) => {
      const aRatio = (load[a.id] ?? 0) / a.concurrency;
      const bRatio = (load[b.id] ?? 0) / b.concurrency;
      return aRatio - bRatio || a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id);
    });
  return candidates[0] ?? null;
}
