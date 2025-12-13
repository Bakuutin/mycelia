import type { Request, Response } from "express";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { redis } from "@/lib/redis.ts";
import { JobTypeSchema } from "@/lib/jobs/types.ts";

export async function apiJobsIdProgressHandler(req: Request, res: Response) {
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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const streamKey = `progress:${jobType}:${jobId}`;
    let lastId = "$";

    const intervalId = setInterval(async () => {
      try {
        const results = await redis.xread(
          "BLOCK",
          1000,
          "STREAMS",
          streamKey,
          lastId,
        );

        if (results && results.length > 0) {
          for (const [_stream, messages] of results) {
            for (const [messageId, fields] of messages) {
              lastId = messageId;

              const data: Record<string, string> = {};
              for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
              }

              res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
          }
        }
      } catch (error) {
        console.error("Error reading progress stream:", error);
      }
    }, 1000);

    req.on("close", () => {
      clearInterval(intervalId);
      res.end();
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }
    console.error("Error in /api/jobs/:id/progress:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
