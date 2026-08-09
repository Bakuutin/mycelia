export interface VoiceProfileAttachTarget {
  id: string;
  name: string;
  isPrimary: boolean;
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
