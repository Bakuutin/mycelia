import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocketSubscription } from "./useWebSocket";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import type { JobInfo } from "@/types/jobs";

export function useJobsListener() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
      };

      if (!jobData?.jobId) return;

      queryClient.setQueryData<JobInfo[]>(["jobs", "all"], (oldJobs = []) => {
        const newState = jobData.state || event.event.replace("job.", "");
        const existingIndex = oldJobs.findIndex((job) => job.id === jobData.jobId);

        if (existingIndex >= 0) {
          const updated = [...oldJobs];
          updated[existingIndex] = {
            ...updated[existingIndex],
            state: newState,
            progress: jobData.progress ?? updated[existingIndex].progress,
            result: jobData.result ?? updated[existingIndex].result,
            failedReason: jobData.failedReason ?? updated[existingIndex].failedReason,
            finishedOn: event.event === "job.completed" ? Date.now() : updated[existingIndex].finishedOn,
            processedOn: event.event === "job.active" ? Date.now() : updated[existingIndex].processedOn,
          };
          return updated;
        } else {
          const newJob: JobInfo = {
            id: jobData.jobId,
            type: jobData.jobType,
            data: {},
            state: newState,
            progress: jobData.progress,
            result: jobData.result,
            timestamp: jobData.timestamp ?? Date.now(),
            failedReason: jobData.failedReason,
          };
          // Keep it sorted by timestamp desc
          const newJobs = [newJob, ...oldJobs];
          return newJobs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 1500); // Allow some buffer over 1000
        }
      });

      if (event.event === "job.completed" && event.data) {
        if (jobData.jobType === "summarization" && jobData.result?.objectId) {
          toast.success("Summarization completed", {
            description: "Your conversation has been summarized successfully.",
            action: {
              label: "Go to conversation",
              onClick: () => navigate(`/objects/${jobData.result.objectId}`),
            },
            duration: 10000,
          });
        } else {
          toast.success("Job completed", {
            description: `${jobData.jobType} job finished successfully.`,
            action: {
              label: "View job",
              onClick: () => navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
            },
            duration: 5000,
          });
        }
      } else if (event.event === "job.failed" && event.data) {
        toast.error("Job failed", {
          description: `${jobData.jobType}: ${jobData.failedReason || "Unknown error"}`,
          action: {
            label: "View job",
            onClick: () => navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
          },
          duration: 10000,
        });
      }
    }
  });

  return { jobs, runningCount, getJobById, isLoading };
}

