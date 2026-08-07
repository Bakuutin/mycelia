import type { Request, Response } from "express";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { uploadToGridFS } from "@/lib/mongo/fs.server.ts";

const DEFAULT_BUCKET = "uploads";

const uploadSchema = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
  bucket: z.enum(["uploads", "voice_samples", "location_files"]).optional(),
});

export type UploadData = z.infer<typeof uploadSchema>;

class FileLike {
  name: string;
  size: number;
  type: string;
  private buffer: Buffer;

  constructor(buffer: Buffer, name: string, type: string) {
    this.buffer = buffer;
    this.name = name;
    this.size = buffer.length;
    this.type = type;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new Uint8Array(this.buffer).buffer;
  }
}

export async function apiFilesUploadHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);

    const body = req.body;
    if (!body || !body.file || !body.filename) {
      res.status(400).json({
        error: "File data and filename required in JSON body",
      });
      return;
    }

    const fileBuffer = Buffer.from(body.file, "base64");
    const file = new FileLike(
      fileBuffer,
      body.filename,
      body.mimetype || "application/octet-stream",
    );

    let metadata: Record<string, any> = {};
    if (body.metadata) {
      if (typeof body.metadata === "string") {
        try {
          metadata = JSON.parse(body.metadata);
        } catch (error) {
          res.status(400).json({ error: "Invalid metadata JSON" });
          return;
        }
      } else {
        metadata = body.metadata;
      }
    }

    const data = uploadSchema.parse({
      metadata,
      bucket: body.bucket,
    });

    const bucketName = data.bucket || DEFAULT_BUCKET;

    const fileId = await uploadToGridFS(
      auth,
      file as any,
      bucketName,
      data.metadata || {},
    );

    res.json({
      success: true,
      file_id: fileId.toString(),
      size: file.size,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }
    console.error("Error in /api/files/upload:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
