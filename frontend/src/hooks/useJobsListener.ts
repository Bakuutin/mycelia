import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocketSubscription } from "./useWebSocket";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import type { JobInfo } from "@/types/jobs";
import { useNotificationStore } from "@/stores/notificationStore";
import { buildSummarizationCompletionNotifications } from "@/lib/jobNotifications";
import {
  buildJobsListRequest,
  type JobListStatus,
  type JobsListView,
  resolveJobEventState,
  shouldIncludeJobEvent,
  shouldRefreshJobsViews,
} from "@/lib/jobListView";

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
    speakerMatching: "Speaker Matching",
    speakerIdentity: "Speaker Identity",
    enrollment: "Voice Enrollment",
    ingestion: "Audio Ingestion",
    vad: "Voice Activity Detection",
  };
  return names[type] ||
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get description from job result */
function getResultDescription(result: any): string | null {
  if (!result) return null;

  if (result.message) return result.message;

  const parts: string[] = [];

  if (
    typeof result.conversationsCreated === "number" &&
    result.conversationsCreated > 0
  ) {
    parts.push(
      `${result.conversationsCreated} conversation${
        result.conversationsCreated !== 1 ? "s" : ""
      }`,
    );
  }
  if (typeof result.chunksCreated === "number" && result.chunksCreated > 0) {
    parts.push(
      `${result.chunksCreated} chunk${result.chunksCreated !== 1 ? "s" : ""}`,
    );
  }
  if (typeof result.processed === "number" && result.processed > 0) {
    parts.push(`${result.processed} processed`);
  }
  if (
    typeof result.chunksProcessed === "number" && result.chunksProcessed > 0
  ) {
    parts.push(
      `${result.chunksProcessed} chunk${
        result.chunksProcessed !== 1 ? "s" : ""
      } processed`,
    );
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

interface UseJobsListenerOptions {
  types?: string[];
  view?: JobsListView;
  statuses?: JobListStatus[];
  limit?: number;
  providerProfileId?: string;
  campaignId?: string;
  refetchInterval?: number | false;
  onJobFinished?: (job: {
    id: string;
    type: string;
    state: "completed" | "failed";
  }) => void;
}

export function useJobsListener(options: UseJobsListenerOptions = {}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { addNotification, showPopups } = useNotificationStore();

  // Create a stable query key that includes the types filter
  const queryKey = [
    "jobs",
    options.view ?? "operational",
    options.types?.length
      ? `types:${[...options.types].sort().join(",")}`
      : "all-types",
    options.statuses?.length
      ? `statuses:${[...options.statuses].sort().join(",")}`
      : "all-statuses",
    options.providerProfileId
      ? `provider:${options.providerProfileId}`
      : "all-providers",
    options.campaignId ? `campaign:${options.campaignId}` : "all-campaigns",
    `limit:${options.limit ?? 1000}`,
  ];

  const { data: jobs = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await api.callResource(
        "jobs",
        buildJobsListRequest(
          options.view ?? "operational",
          options.types,
          {
            statuses: options.statuses,
            limit: options.limit,
            providerProfileId: options.providerProfileId,
            campaignId: options.campaignId,
          },
        ),
      );
      return response as JobInfo[];
    },
    staleTime: options.refetchInterval
      ? Math.min(options.refetchInterval, 30000)
      : 30000,
    refetchInterval: options.refetchInterval,
  });

  const runningCount = jobs.filter(
    (job) =>
      job.state === "active" || job.state === "waiting" ||
      job.state === "delayed",
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
        restarted?: boolean;
      };

      if (!jobData?.jobId) return;

      // Skip jobs outside the selected view, including internal photo children
      // that are represented by their durable batch in the default Jobs UI.
      if (!shouldIncludeJobEvent(jobData.jobType, options.types)) {
        return;
      }

      queryClient.setQueryData<JobInfo[]>(queryKey, (oldJobs = []) => {
        const existingIndex = oldJobs.findIndex((job) =>
          job.id === jobData.jobId
        );

        if (existingIndex >= 0) {
          const updated = [...oldJobs];
          const existing = updated[existingIndex];
          const newState = resolveJobEventState(
            event.event,
            jobData.state,
            existing.state,
          );

          // Determine processedOn and finishedOn with fallbacks
          let processedOn = jobData.processedOn ?? existing.processedOn;
          if (
            !processedOn &&
            (event.event === "job.started" || event.event === "job.active" ||
              event.event === "job.progress" || newState === "active")
          ) {
            processedOn = Date.now();
          }

          const isRunning = newState === "active" ||
            event.event === "job.active" || event.event === "job.started";
          let finishedOn = isRunning
            ? undefined
            : jobData.finishedOn ?? existing.finishedOn;
          if (
            !finishedOn &&
            (event.event === "job.completed" || event.event === "job.failed" ||
              newState === "completed" || newState === "failed")
          ) {
            finishedOn = Date.now();
          }

          updated[existingIndex] = {
            ...existing,
            state: newState,
            progress: jobData.progress ?? existing.progress,
            result: isRunning ? undefined : jobData.result ?? existing.result,
            failedReason: isRunning
              ? undefined
              : jobData.failedReason ?? existing.failedReason,
            finishedOn,
            processedOn,
            restarted: jobData.restarted ?? existing.restarted,
          };
          return updated;
        } else {
          // WebSocket job events intentionally contain only changing runtime
          // fields. Fetch the canonical row once so newly-created jobs retain
          // their immutable routing snapshot (STT server/model) immediately,
          // instead of showing it only after a manual page reload.
          // This is a Mycelia Jobs request, not a provider health probe.
          void queryClient.invalidateQueries({ queryKey });
          return oldJobs;
        }
      });

      if (shouldRefreshJobsViews(event.event) && event.data) {
        // A completed automatic run can move from the operational view to the
        // idle-auto view. Refresh every cached jobs view so the server-side
        // classifier, not a partial WebSocket payload, decides membership.
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        if (jobData.jobType === "speakerIdentity") {
          void queryClient.invalidateQueries({ queryKey: ["speaker-track"] });
          void queryClient.invalidateQueries({
            queryKey: ["speaker-identity-status"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["speaker-identity-campaigns"],
          });
        }
        options.onJobFinished?.({
          id: jobData.jobId,
          type: jobData.jobType,
          state: "completed",
        });
        if (jobData.jobType === "summarization") {
          const notifications = buildSummarizationCompletionNotifications(
            jobData.result,
            jobData.jobId,
          );

          if (notifications.length === 0) return;

          notifications.forEach(addNotification);

          // Show popup toast if enabled
          if (showPopups) {
            const notification = notifications[0];
            const isBatch = notifications.length > 1;
            toast.success(
              isBatch
                ? `${notifications.length} summaries completed`
                : notification.title,
              {
                description: isBatch
                  ? "Open notifications to view each summary."
                  : notification.description,
                action: {
                  label: isBatch
                    ? "View notifications"
                    : notification.action?.label || "View summary",
                  onClick: () =>
                    navigate(
                      isBatch
                        ? "/summaries"
                        : notification.action?.path || "/summaries",
                    ),
                },
                duration: 10000,
              },
            );
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
              action: {
                label: "Details",
                path: `/jobs/${jobData.jobId}?type=${jobData.jobType}`,
              },
            });

            // Show popup toast if enabled
            if (showPopups) {
              toast.success(`${jobName} completed`, {
                description,
                action: {
                  label: "Details",
                  onClick: () =>
                    navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
                },
                duration: 5000,
              });
            }
          }
        }
      } else if (event.event === "job.failed" && event.data) {
        options.onJobFinished?.({
          id: jobData.jobId,
          type: jobData.jobType,
          state: "failed",
        });
        const job = jobs.find((j) => j.id === jobData.jobId);
        const isManualJob = job?.trigger?.type === "manual";

        const jobName = formatJobType(jobData.jobType);
        const reason = jobData.failedReason || "Unknown error";
        const description = reason.length > 100
          ? reason.slice(0, 100) + "..."
          : reason;

        // Always add failed jobs to notification center (important for monitoring)
        addNotification({
          type: "error",
          title: `${jobName} failed`,
          description,
          action: {
            label: "Details",
            path: `/jobs/${jobData.jobId}?type=${jobData.jobType}`,
          },
        });

        // Show popup toast only for manual jobs (to avoid spam from automated failures)
        if (showPopups && isManualJob) {
          toast.error(`${jobName} failed`, {
            description,
            action: {
              label: "Details",
              onClick: () =>
                navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
            },
          });
        }
      }
    }
  });

  return { jobs, runningCount, getJobById, isLoading };
}
