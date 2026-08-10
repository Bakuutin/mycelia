export function isCancelledJobRecord(job: unknown): boolean {
  return (job as { state?: unknown } | null | undefined)?.state ===
    "cancelled";
}

export function diarizationCampaignIdForJob(
  jobId: string,
  jobData: unknown,
): string {
  const explicit = (jobData as { campaignId?: unknown } | null | undefined)
    ?.campaignId;
  return typeof explicit === "string" && explicit.length > 0
    ? explicit
    : `diarization-${jobId}`;
}
