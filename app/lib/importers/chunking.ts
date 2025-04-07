import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { Collection, Db } from "npm:mongodb";
import { ObjectId } from "npm:mongodb";
import { z } from "zod";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

// Add Buffer type
import { Buffer } from "node:buffer";

// Constants
const CHUNK_MAX_LEN_SECONDS = 10;
const TMP_DIR = tmpdir();
const SAMPLE_RATE = 16000;

// Types
export type AudioChunk = {
  format: string;
  original_id: ObjectId;
  metadata: {
    created: Date;
    modified: Date;
    path: string;
    size: number;
  };
  index: number;
  start: Date;
  ingested_at: Date;
  data: Buffer;
};

// Utility functions
function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function getTmpDir(original: string): string {
  return path.join(TMP_DIR, sha(original));
}

async function* splitToOpusChunks(
  original: string,
): AsyncGenerator<[number, string], void, unknown> {
  const destDir = getTmpDir(original);
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });
  const command = new Deno.Command("ffmpeg", {
    args: [
      "-i",
      original,
      "-f",
      "segment",
      "-segment_time",
      CHUNK_MAX_LEN_SECONDS.toString(),
      "-acodec",
      "libopus",
      "-ar",
      SAMPLE_RATE.toString(),
      "-y", // Overwrite output files
      path.join(destDir, "%010d.opus"),
    ],
    stdout: "null",
    stderr: "null",
  });

  const process = command.spawn();
  const watcher = Deno.watchFs(destDir, { recursive: false });

  const stopWatcher = () => {
    setTimeout(() => {
      watcher.close();
    }, 500);
  };

  process.status.then((status) => {
    stopWatcher();
    if (!status.success) {
      throw new Error(`ffmpeg process exited with code ${status.code}`);
    }
  }).catch((error) => {
    stopWatcher();
    console.error("Error in process status promise:", error);
  });

  const seen = new Set<string>();

  for await (const event of watcher) {
    console.log("event", event);
    const { kind, paths } = event;

    if (kind !== "modify") continue;

    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      const index = parseInt(path.split("/").pop()!.split(".")[0]);
      yield [index, path];
    }
  }
}

async function ingestSource(
  original: { path: string; _id: ObjectId; start: Date; platform: any },
): Promise<void> {
  const { path: filePath, _id, start, platform } = original;

  try {
    console.log(`Splitting '${filePath}' into chunks`);

    const db = await getRootDB();
    const audioChunksCollection = db.collection("ts_audio");

    for await (const [index, chunk] of splitToOpusChunks(filePath)) {
      const chunkStart = new Date(
        start.getTime() + index * CHUNK_MAX_LEN_SECONDS * 1000,
      );
      console.log("uploading chunk", chunkStart);

      await audioChunksCollection.insertOne({
        meta: {
          original_id: _id,
        },
        ingested: new Date(),
        index: index,
        start: chunkStart,
        data: Deno.readFileSync(chunk),
      });
    }
  } finally {
    await fs.rm(getTmpDir(filePath), { recursive: true, force: true });
  }
}

export async function ingestPendingSourceFiles() {
  const db = await getRootDB();
  const sources = await db.collection("source_files").find({
    ingested: false,
  }, { sort: { start: -1 } }).toArray();

  for (const source of sources) {
    await db.collection("ts_audio").deleteMany({
      meta: {original_id: source._id},
    });
    await ingestSource(source as any);
    await db.collection("source_files").updateOne({ _id: source._id }, {
      $set: { ingested: true },
    });
  }
}
