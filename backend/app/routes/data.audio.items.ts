import type { Request, Response } from "express";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { type Timestamp, zTimestamp } from "../types/timeline.ts";
import { fetchTimelineData } from "../services/timeline.server.ts";
import type { Resolution } from "@/types/resolution.ts";

export async function dataAudioItemsHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);

    const startParam = req.query.start as string;
    const endParam = req.query.end as string;
    const resolution = req.query.resolution as string;

    if (!startParam || !endParam) {
      res.status(400).json({ error: "Missing required parameters" });
      return;
    }

    const params = {
      start: zTimestamp.parse(startParam),
      end: zTimestamp.parse(endParam),
      resolution: resolution as Resolution,
    };

    const result = await fetchTimelineData(
      auth,
      params.start,
      params.end,
      params.resolution,
    );

    res.json(result);
  } catch (error) {
    if (error instanceof globalThis.Response) {
      const status = error.status;
      const body = await error.json().catch(() => ({}));
      res.status(status === 403 ? 401 : status).json(body);
      return;
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }
    console.error("Error in /data/audio/items:", error);
    res.status(400).json({ error: "Invalid format" });
  }
}
