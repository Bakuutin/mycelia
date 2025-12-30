import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWebSocketSubscription } from "./useWebSocket";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type JobInfo = {
  id: string;
  type: string;
  data: any;
  state: string;
  progress: any;
  result?: any;
  timestamp: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
};

export function useJobsListener() {
  const [runningCount, setRunningCount] = useState(0);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: jobs } = useQuery({
    queryKey: ["jobs", "running"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "list",
        limit: 1000,
        statuses: ["active", "waiting", "delayed"],
      });
      return response as JobInfo[];
    },
  });

  useEffect(() => {
    if (jobs) {
      const running = jobs.filter(
        (job) => job.state === "active" || job.state === "waiting" || job.state === "delayed"
      ).length;
      setRunningCount(running);
    }
  }, [jobs]);

  useWebSocketSubscription("jobs:*", (event) => {
    if (event.event && event.event.startsWith("job.")) {
      const jobData = event.data as {
        jobId: string;
        jobType: string;
        state?: string;
        progress?: any;
        result?: any;
        failedReason?: string;
      };

      if (!jobData?.jobId) return;

      queryClient.setQueryData<JobInfo[]>(["jobs", "running"], (oldJobs = []) => {
        const runningStatuses = ["active", "waiting", "delayed"];
        const newState = jobData.state || event.event.replace("job.", "");
        const isRunning = runningStatuses.includes(newState);

        const existingIndex = oldJobs.findIndex((job) => job.id === jobData.jobId);

        if (existingIndex >= 0) {
          if (isRunning) {
            const updated = [...oldJobs];
            updated[existingIndex] = {
              ...updated[existingIndex],
              state: newState,
              progress: jobData.progress ?? updated[existingIndex].progress,
              result: jobData.result ?? updated[existingIndex].result,
              failedReason: jobData.failedReason ?? updated[existingIndex].failedReason,
            };
            return updated;
          } else {
            return oldJobs.filter((job) => job.id !== jobData.jobId);
          }
        } else if (isRunning) {
          return [
            ...oldJobs,
            {
              id: jobData.jobId,
              type: jobData.jobType,
              data: {},
              state: newState,
              progress: jobData.progress,
              result: jobData.result,
              timestamp: Date.now(),
              failedReason: jobData.failedReason,
            },
          ];
        }

        return oldJobs;
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

  return { runningCount };
}

