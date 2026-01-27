import type { Request, Response } from "express";
import { Buffer } from "node:buffer";
import { ObjectId } from "bson";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getFsResource } from "@/lib/mongo/fs.server.ts";

const uploadBucketName = "uploads";

function contentTypeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "gpx":
      return "application/gpx+xml; charset=utf-8";
    case "geojson":
      return "application/geo+json; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function apiFilesIdHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);
    const id = req.params.id;

    if (!id || !ObjectId.isValid(id)) {
      res.status(400).send("Invalid id");
      return;
    }

    const fs = await getFsResource(auth);
    const files = await fs({
      action: "find",
      bucket: uploadBucketName,
      query: { _id: new ObjectId(id) },
    });

    if (!files || files.length === 0) {
      res.status(404).send("Not found");
      return;
    }

    const file = files[0];
    const data: Uint8Array = await fs({
      action: "download",
      bucket: uploadBucketName,
      id,
    });

    const ext: string = file?.metadata?.extension ||
      (file?.filename?.split(".").pop() ?? "");
    const contentType = contentTypeForExtension(ext || "");

    res.setHeader("Content-Type", contentType);
    res.send(Buffer.from(data));
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return; // Already sent 401 response
    }
    console.error("Error in /api/files/:id:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
