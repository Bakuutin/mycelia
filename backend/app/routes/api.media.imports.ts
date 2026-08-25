import type { Request, Response } from "express";
import multer from "multer";
import { type Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { analyzeMediaUploads } from "@/lib/media/resource.server.ts";
import { asyncHandler } from "@/middleware/asyncHandler.ts";
import {
  type MediaRecognitionTask,
  zMediaRecognitionTask,
} from "@myceliasdk/media.ts";

const upload = multer({
  dest: "/tmp/mycelia-media-uploads",
  limits: { fileSize: 32_000_000, files: 50, fields: 20 },
});
const MAX_UPLOAD_TOTAL_BYTES = 48_000_000;
const uploadMiddleware = upload.array("files", 50);

function receiveFiles(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadMiddleware(req, res, (error: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function authorizeAndReceiveMediaUpload(
  auth: Auth,
  req: Request,
  res: Response,
  authorize: (auth: Auth) => Promise<void> = (currentAuth) =>
    defaultResourceManager.ensureAllowed(currentAuth, {
      path: ["media", "analyzeSource"],
      actions: ["use"],
    }),
  receive: (req: Request, res: Response) => Promise<void> = receiveFiles,
): Promise<void> {
  await authorize(auth);
  await receive(req, res);
}

function parseTasks(raw: unknown): MediaRecognitionTask[] | undefined {
  if (raw === undefined || raw === "") return undefined;
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  return values.map((value) => zMediaRecognitionTask.parse(String(value)));
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Unsupported or invalid media file") ||
    message.includes("exceeds the configured") ||
    message.includes("exceeds the per-asset limit") ||
    message.includes("PDF has") ||
    message.includes("maximum is")
  ) return message;
  return "The media upload could not be prepared. No assets were imported.";
}

export const apiMediaImportsAnalyzeHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const auth = await authenticateOr401(req, res);
    let files: multer.File[] = [];
    try {
      await authorizeAndReceiveMediaUpload(auth, req, res);
      files = (req.files as multer.File[] | undefined) ?? [];
      if (!files.length) {
        res.status(400).json({ error: "At least one media file is required" });
        return;
      }
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
        res.status(413).json({
          error: "The selected upload exceeds the 48 MB request limit",
        });
        return;
      }
      const result = await analyzeMediaUploads(
        auth,
        files.map((file) => ({
          fileName: file.originalname,
          declaredMimeType: file.mimetype,
          readBytes: () => Deno.readFile(file.path),
        })),
        {
          profileId: typeof req.body.profileId === "string"
            ? req.body.profileId
            : undefined,
          requestedTasks: parseTasks(req.body.requestedTasks),
        },
      );
      res.json(result);
    } catch (error) {
      if (error instanceof globalThis.Response) throw error;
      console.error(
        "[media-import] Upload analysis failed:",
        error instanceof Error ? error.message : error,
      );
      const tooLarge = (error as any)?.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? "A file exceeds the 32 MB upload transport limit"
          : publicError(error),
      });
    } finally {
      files = (req.files as multer.File[] | undefined) ?? files;
      await Promise.all(
        files.map((file) => Deno.remove(file.path).catch(() => undefined)),
      );
    }
  },
);
