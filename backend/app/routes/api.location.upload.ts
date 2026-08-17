import type { Request, Response } from "express";
import multer from "multer";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import {
  analyzeLocationFile,
  confirmLocationPreview,
} from "@/lib/location/import.server.ts";
import { asyncHandler } from "@/middleware/asyncHandler.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});
const uploadMiddleware = upload.array("files", 20);

/**
 * Backwards-compatible one-step endpoint. New clients use analyze/confirm.
 * This path still uses the idempotent staged commit and defers conflicts, so
 * it cannot reproduce the former E11000/partial-import failure mode.
 */
export const apiLocationUploadHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const auth = await authenticateOr401(req, res);
    await new Promise<void>((resolve, reject) => {
      uploadMiddleware(req, res, (error: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const files = req.files as multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "At least one track file is required" });
      return;
    }

    const results = [];
    for (const file of files) {
      try {
        const preview = await analyzeLocationFile(auth, {
          originalname: file.originalname,
          mimetype: file.mimetype,
          buffer: new Uint8Array(file.buffer),
        });
        const receipt = preview.canConfirm
          ? await confirmLocationPreview(auth, preview.previewId)
          : {
            duplicate: true,
            importId: preview.exactFileMatch?.importId,
            counts: preview.counts,
          };
        const counts = receipt.counts ?? preview.counts;
        results.push({
          filename: file.originalname,
          importId: receipt.importId,
          pointsImported: receipt.pointsImported ?? counts.newPoints ?? 0,
          pointsDeduplicated: receipt.pointsDeduplicated ??
            counts.matchedPoints ?? 0,
          pointsSkipped: receipt.pointsSkipped ?? counts.skipped ?? 0,
          duplicate: receipt.duplicate ?? false,
          receipt,
        });
      } catch (error) {
        console.error(
          `[location-import] Legacy upload failed for ${file.originalname}:`,
          error instanceof Error ? error.message : error,
        );
        results.push({
          filename: file.originalname,
          pointsImported: 0,
          pointsDeduplicated: 0,
          pointsSkipped: 0,
          error: "The file could not be imported. No partial track is visible.",
          errorCode: "location_import_failed",
        });
      }
    }
    const processed = results.filter((result) => !("error" in result)).length;
    res.json({
      success: processed > 0,
      processed,
      failed: results.length - processed,
      results,
    });
  },
);
