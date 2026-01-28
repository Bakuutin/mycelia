import type { Request, Response as ExpressResponse } from "express";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getTranscriptionResource } from "@/lib/transcription/resource.server.ts";
import multer from "multer";
import { asyncHandler } from "@/middleware/asyncHandler.ts";

const upload = multer({ storage: multer.memoryStorage() });

const uploadMiddleware = upload.single("file");

export const transcriptionAudioHandler = asyncHandler(
  async (req: Request, res: ExpressResponse) => {
    const auth = await authenticateOr401(req, res);

    await new Promise<void>((resolve, reject) => {
      uploadMiddleware(req, res, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    if (!req.file) {
      res.status(400).json({
        error: {
          message: "File is required",
          type: "validation_error",
          code: "missing_file",
        },
      });
      return;
    }

    const transcriptionResource = await getTranscriptionResource(auth);

    const result = await transcriptionResource({
      action: "transcribe",
      file: new Uint8Array(req.file.buffer),
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      language: req.body.language,
      prompt: req.body.prompt,
    });

    if (result instanceof Response) {
      const responseBody = await result.json();
      res.status(result.status).json(responseBody);
      return;
    }

    res.json(result);
  },
);

