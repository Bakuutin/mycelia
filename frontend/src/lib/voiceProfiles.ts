export interface VoiceProfileAttachTarget {
  id: string;
  name: string;
  isPrimary: boolean;
}

export interface VoiceSampleSummaryInput {
  metadata?: { duration?: number };
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
) {
  return {
    speaker_name: profile.name,
    profile_id: profile.id,
    duration: Math.max(0, (end.getTime() - start.getTime()) / 1000),
    source: "timeline_selection",
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
