import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

const SAMPLE_RATE = 16000;
const MAX_CHUNK_DURATION_MS = 10000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;

function parseTimestamp(ts: string): Date {
  const isoDate = new Date(ts);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  const unixTimestamp = parseFloat(ts);
  if (!isNaN(unixTimestamp)) {
    return new Date(unixTimestamp * 1000);
  }

  throw new Error(`Invalid timestamp format: ${ts}`);
}

async function decodeOpusToPcm(opusData: Uint8Array): Promise<Uint8Array> {
  const tempInputPath = await Deno.makeTempFile({ suffix: ".opus" });
  const tempOutputPath = await Deno.makeTempFile({ suffix: ".wav" });

  try {
    await Deno.writeFile(tempInputPath, opusData);

    const ffmpegArgs = [
      "-i",
      tempInputPath,
      "-f",
      "wav",
      "-acodec",
      "pcm_s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-y",
      tempOutputPath,
    ];

    const process = new Deno.Command("ffmpeg", {
      args: ffmpegArgs,
      stdout: "piped",
      stderr: "piped",
    });

    const child = process.spawn();
    const status = await child.status;

    if (!status.success) {
      const stderrReader = child.stderr.getReader();
      const stderr = await stderrReader.read();
      const errorOutput = new TextDecoder().decode(
        stderr.value || new Uint8Array(),
      );
      stderrReader.releaseLock();
      await child.stderr.cancel();
      await child.stdout.cancel();
      throw new Error(`FFmpeg decode failed: ${errorOutput}`);
    }

    await child.stderr.cancel();
    await child.stdout.cancel();

    return await Deno.readFile(tempOutputPath);
  } finally {
    try {
      await Promise.all([
        Deno.remove(tempInputPath),
        Deno.remove(tempOutputPath),
      ]);
    } catch {
    }
  }
}

function extractPcmFromWav(wavData: Uint8Array): Uint8Array {
  const dataMarker = new TextEncoder().encode("data");
  let dataOffset = 0;

  for (let i = 0; i < wavData.length - 4; i++) {
    if (
      wavData[i] === dataMarker[0] &&
      wavData[i + 1] === dataMarker[1] &&
      wavData[i + 2] === dataMarker[2] &&
      wavData[i + 3] === dataMarker[3]
    ) {
      dataOffset = i + 8;
      break;
    }
  }

  if (dataOffset === 0) {
    dataOffset = 44;
  }

  return wavData.slice(dataOffset);
}

function createSilence(durationSeconds: number): Uint8Array {
  const samples = Math.floor(durationSeconds * SAMPLE_RATE);
  const bytes = samples * 2;
  return new Uint8Array(bytes);
}

function createWavFile(pcmData: Uint8Array): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  view.setUint8(0, 0x52);
  view.setUint8(1, 0x49);
  view.setUint8(2, 0x46);
  view.setUint8(3, 0x46);

  const fileSize = 36 + pcmData.length;
  view.setUint32(4, fileSize, true);

  view.setUint8(8, 0x57);
  view.setUint8(9, 0x41);
  view.setUint8(10, 0x56);
  view.setUint8(11, 0x45);

  view.setUint8(12, 0x66);
  view.setUint8(13, 0x6d);
  view.setUint8(14, 0x74);
  view.setUint8(15, 0x20);

  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  view.setUint8(36, 0x64);
  view.setUint8(37, 0x61);
  view.setUint8(38, 0x74);
  view.setUint8(39, 0x61);
  view.setUint32(40, pcmData.length, true);

  const headerArray = new Uint8Array(header);
  const wavFile = new Uint8Array(headerArray.length + pcmData.length);
  wavFile.set(headerArray, 0);
  wavFile.set(pcmData, headerArray.length);

  return wavFile;
}

export async function apiAudioWavHandler(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const auth = await authenticateOr401(req, res);

    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;
    const originalIdParam = req.query.original_id as string | undefined;

    if (!startParam || !endParam) {
      res.status(400).json({
        error: "Missing required 'start' and 'end' parameters",
      });
      return;
    }

    let startDate: Date;
    let endDate: Date;

    try {
      startDate = parseTimestamp(startParam);
      endDate = parseTimestamp(endParam);
      if (endDate <= startDate) {
        res.status(400).json({
          error: "End timestamp must be after start timestamp",
        });
        return;
      }
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid timestamp",
      });
      return;
    }

    let originalId: ObjectId | undefined;
    if (originalIdParam) {
      try {
        originalId = new ObjectId(originalIdParam);
      } catch {
        res.status(400).json({ error: "Invalid original_id format" });
        return;
      }
    }

    const mongoResource = await getMongoResource(auth);

    const queryStart = new Date(
      startDate.getTime() - MAX_CHUNK_DURATION_MS,
    );
    const query: Record<string, any> = {
      start: {
        $gte: queryStart,
        $lt: endDate,
      },
    };

    if (originalId) {
      query.original_id = originalId;
    }

    const chunks = await mongoResource({
      action: "find",
      collection: "audio_chunks",
      query,
      options: { sort: { start: 1 } },
    }) as any[];

    if (chunks.length === 0) {
      res.status(404).json({ error: "No audio chunks found for the specified range" });
      return;
    }

    const pcmChunks: Uint8Array[] = [];
    let currentTime = startDate.getTime();

    for (const chunk of chunks) {
      const chunkStart = new Date(chunk.start).getTime();
      const chunkEnd = chunkStart + (chunk.duration || 0) * 1000;

      if (chunkEnd <= startDate.getTime() || chunkStart >= endDate.getTime()) {
        continue;
      }

      let chunkData: Uint8Array;
      if (chunk.data instanceof Uint8Array) {
        chunkData = chunk.data;
      } else if (chunk.data?.buffer) {
        chunkData = new Uint8Array(chunk.data.buffer);
      } else if (chunk.data instanceof ArrayBuffer) {
        chunkData = new Uint8Array(chunk.data);
      } else {
        console.warn(`Unexpected data format for chunk ${chunk._id}`);
        continue;
      }

      try {
        const decodedWav = await decodeOpusToPcm(chunkData);
        const pcmData = extractPcmFromWav(decodedWav);
        const chunkDurationSeconds = pcmData.length / BYTES_PER_SECOND;
        const actualChunkEnd = chunkStart + chunkDurationSeconds * 1000;

        if (chunkStart > currentTime) {
          const gapSeconds = (chunkStart - currentTime) / 1000;
          const silence = createSilence(gapSeconds);
          pcmChunks.push(silence);
          currentTime = chunkStart;
        }

        let clipStart = 0;
        let clipEnd = pcmData.length;

        if (chunkStart < startDate.getTime()) {
          const offsetSamples = Math.floor(
            (startDate.getTime() - chunkStart) / 1000 * SAMPLE_RATE,
          );
          clipStart = offsetSamples * 2;
        }

        if (actualChunkEnd > endDate.getTime()) {
          const offsetSamples = Math.floor(
            (endDate.getTime() - chunkStart) / 1000 * SAMPLE_RATE,
          );
          clipEnd = offsetSamples * 2;
        }

        if (clipStart < clipEnd) {
          const clippedPcm = pcmData.slice(clipStart, clipEnd);
          pcmChunks.push(clippedPcm);
          currentTime = chunkStart + (clipEnd / 2 / SAMPLE_RATE) * 1000;
        }
      } catch (error) {
        console.warn(
          `Failed to decode chunk ${chunk._id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }

    if (currentTime < endDate.getTime()) {
      const remainingSeconds = (endDate.getTime() - currentTime) / 1000;
      const silence = createSilence(remainingSeconds);
      pcmChunks.push(silence);
    }

    if (pcmChunks.length === 0) {
      res.status(404).json({ error: "No valid audio data found for the specified range" });
      return;
    }

    const totalPcm = new Uint8Array(
      pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of pcmChunks) {
      totalPcm.set(chunk, offset);
      offset += chunk.length;
    }

    const wavFile = createWavFile(totalPcm);

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", wavFile.length.toString());
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audio_${startDate.toISOString()}_${endDate.toISOString()}.wav"`,
    );
    res.send(Buffer.from(wavFile));
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }
    console.error("Error in /api/audio/wav:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

