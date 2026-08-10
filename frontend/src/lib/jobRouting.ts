import type { JobInfo } from "@/types/jobs";

export const DIARIZATION_JOB_TYPES = new Set([
  "diarization",
  "enrollment",
  "profileReenrollment",
]);

export function getDiarizationJobRoute(
  job: JobInfo,
): { name: string; url?: string } | null {
  if (!DIARIZATION_JOB_TYPES.has(job.type)) return null;
  const url = typeof job.data?.diarizationServerUrl === "string"
    ? job.data.diarizationServerUrl
    : undefined;
  const name = job.routingContext?.providerProfileName ||
    job.routingContext?.providerProfileId ||
    (url ? "Diarizator" : undefined);
  return name ? { name, url } : null;
}
