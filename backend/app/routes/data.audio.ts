import type { Request, Response } from "express";
import { ObjectId } from "bson";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { z } from "zod";

const zAudioQueryParams = z.object({
  start: z.coerce.number(),
  lastId: z.string().optional().nullable(),
  limit: z.string().transform((val: string) => parseInt(val, 10)).optional()
    .nullable(),
});

const zAudioSegment = z.object({
  start: z.date(),
  data: z.string(),
  originalID: z.string(),
  _id: z.string(),
});

const zAudioResponse = z.object({
  segments: z.array(zAudioSegment),
});

export async function dataAudioHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);

    const startParam = req.query.start as string;
    const lastIdParam = req.query.lastId as string | undefined;
    const limitParam = req.query.limit as string | undefined;

    if (!startParam) {
      res.status(400).json({ error: "Missing required 'start' parameter" });
      return;
    }

    let queryParams;
    try {
      queryParams = zAudioQueryParams.parse({
        start: startParam,
        lastId: lastIdParam,
        limit: limitParam,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid start parameter" });
        return;
      }
      throw error;
    }

    const startDate = new Date(queryParams.start);
    const limit: number = 1;

    if (isNaN(startDate.getTime())) {
      res.status(400).json({ error: "Invalid start parameter" });
      return;
    }

    const mongoResource = await getMongoResource(auth);

    const load = async (filter: any) =>
      mongoResource({
        action: "find",
        collection: "audio_chunks",
        query: filter,
        options: { sort: { start: 1 }, limit } as any,
      });

    let segments: any[] = [];

    const originalIdParam = req.query.original_id as string | undefined;
    let filterOriginalId: ObjectId | undefined;
    if (originalIdParam) {
      try {
        filterOriginalId = new ObjectId(originalIdParam);
      } catch {
        // ignore invalid original_id
      }
    }

    const filter: any = { start: { $gte: startDate } };
    if (filterOriginalId) {
      filter.original_id = filterOriginalId;
    }

    if (queryParams.lastId) {
      const prevSegment = await mongoResource({
        action: "findOne",
        collection: "audio_chunks",
        query: { _id: new ObjectId(queryParams.lastId) },
      });
      if (!prevSegment) {
        res.status(400).json({ error: "Invalid lastId parameter" });
        return;
      }

      segments = await load({
        start: { $gt: prevSegment.start },
        original_id: prevSegment.original_id,
      });

      if (segments.length === 0) {
        segments = await load({ start: { $gt: prevSegment.start } });
      }
    } else {
      segments = await load(filter);
    }

    segments = segments.map((segment: any) => ({
      start: segment.start,
      data: segment.data.buffer.toString("base64"),
      originalID: segment.original_id?.toString() || "",
      _id: `${segment._id.toString()}`,
    }));

    console.log("Segments", segments.map((segment) => segment.start));

    const response = { segments };
    res.json(zAudioResponse.parse(response));
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
    console.error("Error in /data/audio:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
