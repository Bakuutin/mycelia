import type { Request, Response } from "express";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getQueue } from "@/lib/jobs/queue.ts";
import { JobTypeSchema } from "@/lib/jobs/types.ts";

export async function apiJobsIdHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);
    const jobId = req.params.id;
    const jobType = req.query.type as string;

    if (!jobId) {
      res.status(400).json({ error: "Job ID required" });
      return;
    }

    if (!jobType) {
      res.status(400).json({ error: "Job type required (query param: ?type=vad)" });
      return;
    }

    const parseResult = JobTypeSchema.safeParse(jobType);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid job type" });
      return;
    }

    const queue = getQueue(parseResult.data);
    const job = await queue.getJob(jobId);

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const state = await job.getState();
    const progress = job.progress;
    const returnValue = job.returnvalue;

    res.json({
      id: job.id,
      name: job.name,
      type: jobType,
      data: job.data,
      state,
      progress,
      result: returnValue,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }
    console.error("Error in /api/jobs/:id:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
