import type { Request, Response } from "express";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import multer from "multer";
import { ObjectId } from "bson";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { uploadToGridFS } from "@/lib/mongo/fs.server.ts";
import { asyncHandler } from "@/middleware/asyncHandler.ts";
import {
  detectFormat,
  type ParsedPoint,
  parseTrackFile,
} from "@/lib/location/parse.server.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per track file
});

const uploadMiddleware = upload.array("files", 20);

const INSERT_BATCH = 5000;

function pointHash(p: ParsedPoint): string {
  return `${p.ts.getTime()}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;
}

export const apiLocationUploadHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const auth = await authenticateOr401(req, res);

    await new Promise<void>((resolve, reject) => {
      uploadMiddleware(req, res, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const files = req.files as multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "At least one track file is required" });
      return;
    }

    const mongo = await getMongoResource(auth);

    const results: Array<{
      filename: string;
      importId?: string;
      pointsImported: number;
      pointsDeduplicated: number;
      pointsSkipped: number;
      duplicate?: boolean;
      error?: string;
    }> = [];

    for (const file of files) {
      try {
        const format = detectFormat(file.originalname);
        if (!format) {
          throw new Error("Unsupported format (expected .gpx, .kml or .kmz)");
        }

        const bytes = new Uint8Array(file.buffer);
        const contentHash = createHash("sha256").update(bytes).digest("hex");

        const existing = await mongo({
          action: "findOne",
          collection: "location_imports",
          query: { contentHash },
        });
        if (existing) {
          results.push({
            filename: file.originalname,
            importId: existing._id.toString(),
            pointsImported: 0,
            pointsDeduplicated: 0,
            pointsSkipped: 0,
            duplicate: true,
          });
          continue;
        }

        const { points, skipped } = parseTrackFile(format, bytes);
        if (points.length === 0) {
          throw new Error(
            skipped > 0
              ? `No timestamped points found (${skipped} coordinates without timestamps were skipped)`
              : "No location points found in file",
          );
        }

        const fileId = await uploadToGridFS(
          auth,
          new File([new Uint8Array(file.buffer)], file.originalname, {
            type: file.mimetype,
          }),
          "location_files",
          { source: "location-import" },
        );

        const importId = new ObjectId();
        let inserted = 0;
        let deduplicated = 0;

        for (let i = 0; i < points.length; i += INSERT_BATCH) {
          const batch = points.slice(i, i + INSERT_BATCH);
          const hashes = batch.map(pointHash);
          const existingDocs: Array<{ hash: string }> = await mongo({
            action: "find",
            collection: "location_points",
            query: { hash: { $in: hashes } },
            options: { projection: { hash: 1 } },
          });
          const known = new Set(existingDocs.map((d) => d.hash));
          const docs = batch
            .filter((_, idx) => !known.has(hashes[idx]))
            .map((p) => ({
              ts: p.ts,
              loc: { type: "Point", coordinates: [p.lng, p.lat] },
              ...(p.ele !== undefined ? { ele: p.ele } : {}),
              importId,
              hash: pointHash(p),
              createdAt: new Date(),
            }));
          deduplicated += batch.length - docs.length;
          if (docs.length > 0) {
            await mongo({
              action: "insertMany",
              collection: "location_points",
              docs,
            });
            inserted += docs.length;
          }
        }

        await mongo({
          action: "insertOne",
          collection: "location_imports",
          doc: {
            _id: importId,
            filename: file.originalname,
            format,
            contentHash,
            fileId,
            pointCount: inserted,
            dedupedCount: deduplicated,
            skippedCount: skipped,
            timeRange: {
              start: points[0].ts,
              end: points[points.length - 1].ts,
            },
            status: "parsed",
            createdAt: new Date(),
            createdBy: auth.principal || "web",
          },
        });

        results.push({
          filename: file.originalname,
          importId: importId.toString(),
          pointsImported: inserted,
          pointsDeduplicated: deduplicated,
          pointsSkipped: skipped,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `Failed to import track ${file.originalname}:`,
          errorMsg,
        );
        results.push({
          filename: file.originalname,
          pointsImported: 0,
          pointsDeduplicated: 0,
          pointsSkipped: 0,
          error: errorMsg,
        });
      }
    }

    const successCount = results.filter((r) => !r.error).length;
    res.json({
      success: successCount > 0,
      processed: successCount,
      failed: results.length - successCount,
      results,
    });
  },
);
