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
          
          toast.success("Summarization completed", {
            description: `"${title}"${dateStr ? ` • ${dateStr}` : ""}`,
            action: {
              label: "View",
              onClick: () => navigate(`/objects/${result.objectId}`),
            },
            duration: 10000,
          });
        } else {
          const job = jobs.find((j) => j.id === jobData.jobId);
          if (job?.trigger?.type === "manual") {
            toast.success("Job completed", {
              description: `${jobData.jobType} job finished successfully.`,
              action: {
                label: "View job",
                onClick: () => navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
              },
              duration: 5000,
            });
          }
        }
      } else if (event.event === "job.failed" && event.data) {

        // check if the job is a manual job
        const job = jobs.find((j) => j.id === jobData.jobId);
        if (job?.trigger?.type != "manual") {
          return;
        }

        toast.error("Job failed", {
          description: `${jobData.jobType}: ${jobData.failedReason || "Unknown error"}`,
          action: {
            label: "View job",
            onClick: () => navigate(`/jobs/${jobData.jobId}?type=${jobData.jobType}`),
          },
        });
      }
    }
  });

  return { jobs, runningCount, getJobById, isLoading };
}

