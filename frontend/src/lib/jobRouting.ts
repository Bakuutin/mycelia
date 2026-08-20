import type { JobInfo } from "@/types/jobs";

export const DIARIZATION_JOB_TYPES = new Set([
  "diarization",
  "enrollment",
  "profileReenrollment",
]);

export function getDiarizationJobRoute(
  job: JobInfo,
): { id?: string; name: string; url?: string } | null {
  if (!DIARIZATION_JOB_TYPES.has(job.type)) return null;
  const url = typeof job.data?.diarizationServerUrl === "string"
    ? job.data.diarizationServerUrl
    : undefined;
  const id = job.routingContext?.providerProfileId;
  const name = job.routingContext?.providerProfileName ||
    id ||
    (url ? "Diarizator" : undefined);
  return name ? { ...(id ? { id } : {}), name, url } : null;
}
