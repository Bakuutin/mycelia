import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocketSubscription } from "./useWebSocket";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import type { JobInfo } from "@/types/jobs";
import { useNotificationStore } from "@/stores/notificationStore";
import { isEmptyJobResult } from "@/lib/jobUtils";

/** Format job type for display */
function formatJobType(type: string): string {
  const names: Record<string, string> = {
    summarization: "Summarization",
    transcription: "Transcription",
    transcription_sequence_creator: "Transcription Queue",
    conversationExtractor: "Conversation Extraction",
    conversationChunkCreator: "Conversation Chunking",
    histRecalculation: "History Recalculation",
    diarization: "Speaker Diarization",
    ingestion: "Audio Ingestion",
    vad: "Voice Activity Detection",
  };
  return names[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get description from job result */
function getResultDescription(result: any): string | null {
  if (!result) return null;

  if (result.message) return result.message;

  const parts: string[] = [];

  if (typeof result.conversationsCreated === "number" && result.conversationsCreated > 0) {
    parts.push(`${result.conversationsCreated} conversation${result.conversationsCreated !== 1 ? "s" : ""}`);
  }
  if (typeof result.chunksCreated === "number" && result.chunksCreated > 0) {
    parts.push(`${result.chunksCreated} chunk${result.chunksCreated !== 1 ? "s" : ""}`);
  }
  if (typeof result.processed === "number" && result.processed > 0) {
    parts.push(`${result.processed} processed`);
  }
  if (typeof result.chunksProcessed === "number" && result.chunksProcessed > 0) {
    parts.push(`${result.chunksProcessed} chunk${result.chunksProcessed !== 1 ? "s" : ""} processed`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

export function useJobsListener() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { addNotification, showPopups, hideEmptyJobs } = useNotificationStore();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs", "all"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "list",
        limit: 1000,
        statuses: ["active", "waiting", "delayed", "completed", "failed"],
      });
      return response as JobInfo[];
    },
    staleTime: 30000,
  });

  const runningCount = jobs.filter(
    (job) => job.state === "active" || job.state === "waiting" || job.state === "delayed"
  ).length;

  const getJobById = (id: string) => jobs.find((job) => job.id === id);

  useWebSocketSubscription("jobs:*", (event) => {
    if (event.event && event.event.startsWith("job.")) {
      const jobData = event.data as {
        jobId: string;
        jobType: string;
        state?: string;
        progress?: any;
        result?: any;
        failedReason?: string;
        timestamp?: number;
        processedOn?: number;
        finishedOn?: number;
      };

      if (!jobData?.jobId) return;

      queryClient.setQueryData<JobInfo[]>(["jobs", "all"], (oldJobs = []) => {
        const newState = jobData.state || event.event.replace("job.", "");
        const existingIndex = oldJobs.findIndex((job) => job.id === jobData.jobId);

        if (existingIndex >= 0) {
          const updated = [...oldJobs];
          const existing = updated[existingIndex];

          // Determine processedOn and finishedOn with fallbacks
          let processedOn = jobData.processedOn ?? existing.processedOn;
          if (!processedOn && (event.event === "job.started" || event.event === "job.active" || event.event === "job.progress" || newState === "active")) {
            processedOn = Date.now();
          }

          let finishedOn = jobData.finishedOn ?? existing.finishedOn;
          if (!finishedOn && (event.event === "job.completed" || event.event === "job.failed" || newState === "completed" || newState === "failed")) {
            finishedOn = Date.now();
          }

          updated[existingIndex] = {
            ...existing,
            state: newState,
            progress: jobData.progress ?? existing.progress,
            result: jobData.result ?? existing.result,
            failedReason: jobData.failedReason ?? existing.failedReason,
            finishedOn,
            processedOn,
          };
          return updated;
        } else {
          const processedOn = jobData.processedOn || (event.event === "job.started" || event.event === "job.active" || event.event === "job.progress" || newState === "active" ? Date.now() : undefined);
          const finishedOn = jobData.finishedOn || (event.event === "job.completed" || event.event === "job.failed" || newState === "completed" || newState === "failed" ? Date.now() : undefined);

          const newJob: JobInfo = {
            id: jobData.jobId,
            type: jobData.jobType,
            data: {},
            state: newState,
            progress: jobData.progress,
            result: jobData.result,
            timestamp: jobData.timestamp ?? Date.now(),
            failedReason: jobData.failedReason,
            processedOn,
            finishedOn,
          };
          // Keep it sorted by timestamp desc
          const newJobs = [newJob, ...oldJobs];
          return newJobs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 1500); // Allow some buffer over 1000
        }
      });

      if (event.event === "job.completed" && event.data) {
        // Skip empty job notifications if hideEmptyJobs is enabled
        const isEmpty = isEmptyJobResult(
          jobData.jobType,
          "completed",
          jobData.progress,
          jobData.result
        );
        if (hideEmptyJobs && isEmpty) {
          return;
        }

        if (jobData.jobType === "summarization" && jobData.result?.objectId) {
          const result = jobData.result as { objectId: string; title?: string; end?: string };
          const title = result.title || "Conversation";
          const dateStr = result.end
            ? new Date(result.end).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              })
            : "";

          const description = `"${title}"${dateStr ? ` • ${dateStr}` : ""}`;

          // Add to notification center
          addNotification({
            type: "success",
            title: "Summarization completed",
            description,
            action: { label: "View", path: `/objects/${result.objectId}` },
          });

          // Show popup toast if enabled
          if (showPopups) {
            toast.success("Summarization completed", {
              description,
              action: {
                label: "View",
                onClick: () => navigate(`/objects/${result.objectId}`),
              },
              duration: 10000,
            });
          }
        } else {
          const job = jobs.find((j) => j.id === jobData.jobId);
          if (job?.trigger?.type === "manual") {
            const jobName = formatJobType(jobData.jobType);
            const resultInfo = getResultDescription(jobData.result);
            const description = resultInfo || "Finished successfully";

            // Add to notification center
            addNotification({
              type: "success",
              title: `${jobName} completed`,
              description,
              action: { label: "Details", path: `/jobs/${jobData.jobId}?type=${jobData.jobType}` },
            });

            // Show popup toast if enabled
            if (showPopups) {
              toast.success(`${jobName} completed`, {
                description,
                action: {
                  label: "Details",
                  onClick: () => navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
                },
                duration: 5000,
              });
            }
          }
        }
      } else if (event.event === "job.failed" && event.data) {
        const job = jobs.find((j) => j.id === jobData.jobId);
        const isManualJob = job?.trigger?.type === "manual";

        const jobName = formatJobType(jobData.jobType);
        const reason = jobData.failedReason || "Unknown error";
        const description = reason.length > 100 ? reason.slice(0, 100) + "..." : reason;

        // Always add failed jobs to notification center (important for monitoring)
        addNotification({
          type: "error",
          title: `${jobName} failed`,
          description,
          action: { label: "Details", path: `/jobs/${jobData.jobId}?type=${jobData.jobType}` },
        });

        // Show popup toast only for manual jobs (to avoid spam from automated failures)
        if (showPopups && isManualJob) {
          toast.error(`${jobName} failed`, {
            description,
            action: {
              label: "Details",
              onClick: () => navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
            },
          });
        }
      }
    }
  });

  return { jobs, runningCount, getJobById, isLoading };
}
