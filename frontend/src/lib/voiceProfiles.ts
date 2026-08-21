export interface VoiceProfileAttachTarget {
  id: string;
  name: string;
  isPrimary: boolean;
}

export interface VoiceSampleSummaryInput {
  metadata?: { duration?: number };
}

const RECENT_VOICE_PROFILES_KEY = "mycelia.recentVoiceProfiles";
const RECENT_VOICE_PROFILES_LIMIT = 12;

export function readRecentVoiceProfileIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_VOICE_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string =>
      typeof id === "string" && id.length > 0
    ).slice(0, RECENT_VOICE_PROFILES_LIMIT);
  } catch {
    return [];
  }
}

export function rememberVoiceProfile(profileId: string): string[] {
  const normalizedId = profileId.trim();
  if (!normalizedId) return readRecentVoiceProfileIds();
  const next = [
    normalizedId,
    ...readRecentVoiceProfileIds().filter((id) => id !== normalizedId),
  ].slice(0, RECENT_VOICE_PROFILES_LIMIT);
  try {
    localStorage.setItem(RECENT_VOICE_PROFILES_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable. The caller still receives session state.
  }
  return next;
}

export function orderVoiceProfilesByRecent<T>(
  profiles: T[],
  getId: (profile: T) => string,
  recentIds = readRecentVoiceProfileIds(),
): T[] {
  const recentOrder = new Map(recentIds.map((id, index) => [id, index]));
  return profiles.map((profile, index) => ({ profile, index })).sort((a, b) => {
    const aRecent = recentOrder.get(getId(a.profile));
    const bRecent = recentOrder.get(getId(b.profile));
    if (aRecent !== undefined || bRecent !== undefined) {
      if (aRecent === undefined) return 1;
      if (bRecent === undefined) return -1;
      if (aRecent !== bRecent) return aRecent - bRecent;
    }
    return a.index - b.index;
  }).map(({ profile }) => profile);
}

export function summarizeVoiceSamples(
  samples: VoiceSampleSummaryInput[] | undefined,
  fallback: { count: number; duration: number },
) {
  if (!samples) return fallback;
  return {
    count: samples.length,
    duration: samples.reduce(
      (total, sample) => total + (sample.metadata?.duration ?? 0),
      0,
    ),
  };
}

export function buildTimelineSampleMetadata(
  profile: VoiceProfileAttachTarget,
  start: Date,
  end: Date,
  source = "timeline_selection",
) {
  return {
    speaker_name: profile.name,
    profile_id: profile.id,
    duration: Math.max(0, (end.getTime() - start.getTime()) / 1000),
    source,
    source_start: start.toISOString(),
    source_end: end.toISOString(),
    uploaded_at: new Date().toISOString(),
  };
}

export function buildAttachSampleOperations(
  sampleId: string,
  profile: VoiceProfileAttachTarget,
) {
  return {
    link: {
      action: "updateOne" as const,
      collection: "voice_samples.files",
      query: { _id: { $oid: sampleId } },
      update: { $set: { "metadata.profile_id": profile.id } },
    },
    enrollment: {
      action: "enqueue" as const,
      data: {
        type: "enrollment" as const,
        name: profile.name,
        profile_id: profile.id,
        is_primary: profile.isPrimary,
        sample_file_id: sampleId,
      },
    },
  };
}
