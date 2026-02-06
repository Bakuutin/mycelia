import type { Request, Response } from "express";
import { ObjectId } from "bson";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

const COLLECTION = "marked_ranges";

function handleRouteError(error: unknown, res: Response, label: string) {
  if (error instanceof globalThis.Response) {
    error.json().catch(() => ({})).then((body) => {
      const status = error.status;
      res.status(status === 403 ? 401 : status).json(body);
    });
    return;
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return;
  }
  console.error(`Error in ${label}:`, error);
  res.status(500).json({ error: "Internal server error" });
}

/**
 * GET /data/marked-ranges
 * Returns all marked ranges, sorted by createdAt descending.
 */
export async function listMarkedRangesHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);
    const mongoResource = await getMongoResource(auth);

    const ranges = await mongoResource({
      action: "find",
      collection: COLLECTION,
      query: {},
      options: { sort: { createdAt: -1 } },
    }) as any[];

    res.json({
      ranges: ranges.map((r: any) => ({
        id: r._id.toString(),
        start: r.start,
        end: r.end,
        label: r.label,
        color: r.color,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    handleRouteError(error, res, "GET /data/marked-ranges");
  }
}

/**
 * POST /data/marked-ranges
 * Create a new marked range. Body: { start, end, label?, color? }
 */
export async function createMarkedRangeHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);
    const mongoResource = await getMongoResource(auth);

    const { start, end, label, color } = req.body;
    if (!start || !end) {
      res.status(400).json({ error: "Missing required 'start' and 'end' fields" });
      return;
    }

    const doc = {
      start: new Date(start),
      end: new Date(end),
      label: label || undefined,
      color: color || undefined,
      createdAt: new Date(),
    };

    const result = await mongoResource({
      action: "insertOne",
      collection: COLLECTION,
      doc,
    }) as any;

    res.json({
      id: result.insertedId.toString(),
      ...doc,
    });
  } catch (error) {
    handleRouteError(error, res, "POST /data/marked-ranges");
  }
}

/**
 * PUT /data/marked-ranges/:id
 * Update a marked range's label and/or color. Body: { label?, color? }
 */
export async function updateMarkedRangeHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);
    const mongoResource = await getMongoResource(auth);

    const { id } = req.params;
    if (!id || !ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const updates: Record<string, any> = {};
    if (req.body.label !== undefined) updates.label = req.body.label;
    if (req.body.color !== undefined) updates.color = req.body.color;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    await mongoResource({
      action: "updateOne",
      collection: COLLECTION,
      query: { _id: new ObjectId(id) },
      update: { $set: updates },
    });

    res.json({ ok: true });
  } catch (error) {
    handleRouteError(error, res, "PUT /data/marked-ranges/:id");
  }
}

/**
 * DELETE /data/marked-ranges/:id
 * Delete a marked range.
 */
export async function deleteMarkedRangeHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);
    const mongoResource = await getMongoResource(auth);

    const { id } = req.params;
    if (!id || !ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    await mongoResource({
      action: "deleteOne",
      collection: COLLECTION,
      query: { _id: new ObjectId(id) },
    });

    res.json({ ok: true });
  } catch (error) {
    handleRouteError(error, res, "DELETE /data/marked-ranges/:id");
  }
}
