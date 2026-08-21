export type SpeakerIdentityLaunchRun = {
  runId: string;
  status: string;
  generation?: number;
  embeddingSpaceId?: string;
  range?: {
    start?: Date | string;
    end?: Date | string;
  };
};

export type SpeakerIdentityLaunchSnapshot = {
  profileId: string;
  profileRevision: number;
  calibrationId: string;
  embeddingSpaceId: string;
  runId: string;
  start: Date;
  end: Date;
  limit?: number;
};

export function compatibleSpeakerIdentityRuns(
  runs: SpeakerIdentityLaunchRun[],
  embeddingSpaceId: string | null | undefined,
): SpeakerIdentityLaunchRun[] {
  if (!embeddingSpaceId) return [];
  return runs.filter((run) =>
    run.status === "active" && run.embeddingSpaceId === embeddingSpaceId
  );
}

export function buildSpeakerIdentityLaunchData(
  snapshot: SpeakerIdentityLaunchSnapshot,
) {
  return {
    type: "speakerIdentity" as const,
    runId: snapshot.runId,
    profileId: snapshot.profileId,
    profileRevision: snapshot.profileRevision,
    calibrationId: snapshot.calibrationId,
    start: snapshot.start,
    end: snapshot.end,
    limit: snapshot.limit ?? 1000,
  };
}
