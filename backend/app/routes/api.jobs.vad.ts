import type { Request, Response } from "express";
import { z } from "zod";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { enqueueJob } from "@/lib/jobs/queue.ts";
import { VadJobDataSchema } from "@/lib/jobs/types.ts";

export async function apiJobsVadHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);

    const data = VadJobDataSchema.parse({
      ...req.body,
      type: "vad",
    });

    const job = await enqueueJob(data, {
      priority: req.body.priority,
    });

    res.json({
      success: true,
      jobId: job.id,
      jobType: "vad",
      data: job.data,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid request data",
        details: error.errors,
      });
      return;
    }
    console.error("Error in /api/jobs/vad:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
