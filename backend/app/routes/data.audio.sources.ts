import type { Request, Response } from "express";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

/**
 * GET /data/audio/sources?start=<timestamp>&end=<timestamp>
 * Returns distinct audio sources (original_id) within a time range,
 * with their first/last chunk timestamps and chunk counts.
 */
export async function dataAudioSourcesHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);

    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    if (!startParam || !endParam) {
      res.status(400).json({ error: "Missing required 'start' and 'end' parameters" });
      return;
    }

    const startMs = parseInt(startParam, 10);
    const endMs = parseInt(endParam, 10);
    if (isNaN(startMs) || isNaN(endMs)) {
      res.status(400).json({ error: "Invalid timestamp parameters" });
      return;
    }

    const startDate = new Date(startMs);
    const endDate = new Date(endMs);

    const mongoResource = await getMongoResource(auth);

    const results = await mongoResource({
      action: "aggregate",
      collection: "audio_chunks",
      pipeline: [
        {
          $match: {
            start: { $gte: startDate, $lt: endDate },
            original_id: { $exists: true },
          },
        },
        {
          $group: {
            _id: "$original_id",
            count: { $sum: 1 },
            firstChunk: { $min: "$start" },
            lastChunk: { $max: "$start" },
          },
        },
        { $sort: { firstChunk: 1 } },
      ],
    }) as any[];

    // Look up source file names
    const sourceIds = results.map((r: any) => r._id);
    const sourceFiles = sourceIds.length > 0
      ? await mongoResource({
          action: "find",
          collection: "source_files",
          query: { _id: { $in: sourceIds } },
          options: { projection: { _id: 1, metadata: 1, extension: 1, created_by: 1, start: 1 } },
        }) as any[]
      : [];

    const sourceMap = new Map(sourceFiles.map((sf: any) => [sf._id.toString(), sf]));

    const sources = results.map((r: any) => {
      const sf = sourceMap.get(r._id.toString());
      const label = sf?.metadata?.deviceName
        || sf?.metadata?.filename
        || sf?.created_by
        || r._id.toString().slice(-6);
      return {
        originalId: r._id.toString(),
        label,
        count: r.count,
        firstChunk: r.firstChunk,
        lastChunk: r.lastChunk,
      };
    });

    res.json({ sources });
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
    console.error("Error in /data/audio/sources:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
