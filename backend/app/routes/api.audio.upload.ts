import type { Request, Response } from "express";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import {
  createSourceFile,
  processAudioFile,
  createAudioChunk,
} from "@/services/streaming.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import multer from "npm:multer@^1.4.5-lts.1";
import { asyncHandler } from "@/middleware/asyncHandler.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

const uploadMiddleware = upload.array("files", 20);

export const apiAudioUploadHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const auth = await authenticateOr401(req, res);

    await new Promise<void>((resolve, reject) => {
      uploadMiddleware(req, res, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "At least one audio file is required" });
      return;
    }

    const results: Array<{
      filename: string;
      sourceFileId: string;
      chunks: number;
      durationMs: number;
      error?: string;
    }> = [];

    for (const file of files) {
      try {
        const audioFile = new File(
          [new Uint8Array(file.buffer)],
          file.originalname,
          { type: file.mimetype },
        );

        // Create source file record
        const sourceFileId = await createSourceFile(
          new Date(),
          file.size,
          file.originalname,
          { originalMimetype: file.mimetype },
          auth.principal || "web",
        );

        // Process audio to opus
        const { audioData, actualDurationMs } = await processAudioFile(audioFile);

        // Store as a single audio chunk
        await createAudioChunk(
          audioData,
          new Date(),
          0,
          sourceFileId,
          "opus",
        );

        // Mark source file as ingested
        const mongoResource = await getMongoResource(auth);
        await mongoResource({
          action: "updateOne",
          collection: "source_files",
          query: { _id: sourceFileId },
          update: {
            $set: {
              ingested: true,
              ingested_at: new Date(),
              processing_status: "complete",
            },
          },
        });

        results.push({
          filename: file.originalname,
          sourceFileId: sourceFileId.toString(),
          chunks: 1,
          durationMs: actualDurationMs,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to process ${file.originalname}:`, errorMsg);
        results.push({
          filename: file.originalname,
          sourceFileId: "",
          chunks: 0,
          durationMs: 0,
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
