import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { authenticateOr401 } from "../lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

const SAMPLE_RATE = 16000;
const MAX_CHUNK_DURATION_MS = 10000; // 10 seconds in milliseconds
const MAX_BUFFER_AHEAD_SECONDS = 60; // Maximum 1 minute of audio buffered ahead
const BYTES_PER_SECOND = SAMPLE_RATE * 2; // 16-bit mono = 2 bytes per sample

/**
 * Parse timestamp from ISO string or Unix timestamp
 */
function parseTimestamp(ts: string): Date {
  // Try ISO format first
  const isoDate = new Date(ts);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try Unix timestamp
  const unixTimestamp = parseFloat(ts);
  if (!isNaN(unixTimestamp)) {
    return new Date(unixTimestamp * 1000);
  }

  throw new Error(`Invalid timestamp format: ${ts}`);
}

/**
 * Decode opus audio to PCM WAV using ffmpeg
 */
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
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract PCM audio data from WAV file (skip WAV header)
 */
function extractPcmFromWav(wavData: Uint8Array): Uint8Array {
  // WAV header is typically 44 bytes, but can vary
  // Look for "data" chunk marker
  const dataMarker = new TextEncoder().encode("data");
  let dataOffset = 0;

  for (let i = 0; i < wavData.length - 4; i++) {
    if (
      wavData[i] === dataMarker[0] &&
      wavData[i + 1] === dataMarker[1] &&
      wavData[i + 2] === dataMarker[2] &&
      wavData[i + 3] === dataMarker[3]
    ) {
      // Found "data" marker, skip 4 bytes for "data" + 4 bytes for size
      dataOffset = i + 8;
      break;
    }
  }

  if (dataOffset === 0) {
    // Fallback: assume standard 44-byte header
    dataOffset = 44;
  }

  return wavData.slice(dataOffset);
}

/**
 * Create silence PCM data (16-bit, mono)
 */
function createSilence(durationSeconds: number): Uint8Array {
  const samples = Math.floor(durationSeconds * SAMPLE_RATE);
  const bytes = samples * 2; // 16-bit = 2 bytes per sample
  return new Uint8Array(bytes);
}

/**
 * Write WAV header to response
 */
function writeWavHeader(res: Response, dataSize: number): void {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF header
  view.setUint8(0, 0x52); // 'R'
  view.setUint8(1, 0x49); // 'I'
  view.setUint8(2, 0x46); // 'F'
  view.setUint8(3, 0x46); // 'F'

  const fileSize = 36 + dataSize;
  view.setUint32(4, fileSize, true);

  view.setUint8(8, 0x57); // 'W'
  view.setUint8(9, 0x41); // 'A'
  view.setUint8(10, 0x56); // 'V'
  view.setUint8(11, 0x45); // 'E'

  // fmt chunk
  view.setUint8(12, 0x66); // 'f'
  view.setUint8(13, 0x6d); // 'm'
  view.setUint8(14, 0x74); // 't'
  view.setUint8(15, 0x20); // ' '

  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (PCM)
  view.setUint16(22, 1, true); // channels (mono)
  view.setUint32(24, SAMPLE_RATE, true); // sample rate
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  view.setUint8(36, 0x64); // 'd'
  view.setUint8(37, 0x61); // 'a'
  view.setUint8(38, 0x74); // 't'
  view.setUint8(39, 0x61); // 'a'
  view.setUint32(40, dataSize, true); // data size

  res.write(new Uint8Array(header));
}

export async function apiAudioStreamHandler(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const auth = await authenticateOr401(req, res);

    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;
    const originalIdParam = req.query.original_id as string | undefined;

    if (!startParam) {
      res.status(400).json({ error: "Missing required 'start' parameter" });
      return;
    }

    let startDate: Date;
    let endDate: Date | null = null;

    try {
      startDate = parseTimestamp(startParam);
      if (endParam) {
        endDate = parseTimestamp(endParam);
        if (endDate <= startDate) {
          res.status(400).json({
            error: "End timestamp must be after start timestamp",
          });
          return;
        }
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

    // Build query similar to play.py's get_chunks_in_range
    const queryStart = new Date(
      startDate.getTime() - MAX_CHUNK_DURATION_MS,
    );
    const query: Record<string, any> = {
      start: {
        $gte: queryStart,
      },
    };

    if (endDate) {
      query.start.$lt = endDate;
    }

    if (originalId) {
      query.original_id = originalId;
    }

    // Set up streaming response
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Transfer-Encoding", "chunked");

    const endTime = endDate ? endDate.getTime() : null;
    let currentTime = startDate.getTime();
    let streamedEndTime = startDate.getTime();
    let totalPcmSize = 0;

    // Estimate total size for WAV header (can be approximate for streaming)
    const estimatedDurationSeconds = endTime
      ? (endTime - startDate.getTime()) / 1000
      : 3600; // Default to 1 hour if no end time
    const estimatedDataSize = Math.floor(estimatedDurationSeconds * BYTES_PER_SECOND);
    writeWavHeader(res, estimatedDataSize);

    // Buffer for chunks that are processed but not yet streamed (sorted by time)
    const streamBuffer: Array<{ startTime: number; endTime: number; data: Uint8Array }> = [];

    // Use cursor-based pagination with smaller batches for streaming
    const batchSize = 20;
    let cursorId: string | null = null;
    let hasMore = true;
    let pendingChunks: any[] = [];

    const flushBuffer = () => {
      // Stream all buffered chunks that are ready (in chronological order)
      while (streamBuffer.length > 0) {
        const item = streamBuffer[0];
        // Stream if this chunk starts at or before what we've already streamed
        // (or if it's the first item and we haven't streamed anything yet)
        if (item.startTime <= streamedEndTime || (totalPcmSize === 0 && item.startTime >= startDate.getTime())) {
          res.write(item.data);
          totalPcmSize += item.data.length;
          streamedEndTime = Math.max(streamedEndTime, item.endTime);
          streamBuffer.shift();
        } else {
          break;
        }
      }
    };

    const addToBuffer = (startTime: number, data: Uint8Array) => {
      const durationSeconds = data.length / BYTES_PER_SECOND;
      const endTime = startTime + durationSeconds * 1000;
      streamBuffer.push({ startTime, endTime, data });
      streamBuffer.sort((a, b) => a.startTime - b.startTime);
    };

    const getBufferedTimeSpan = (): number => {
      if (streamBuffer.length === 0) return 0;
      const earliest = streamBuffer[0].startTime;
      const latest = streamBuffer[streamBuffer.length - 1].endTime;
      return (latest - earliest) / 1000;
    };

    try {
      // Get first batch
      const firstBatch = await mongoResource({
        action: "getFirstBatch",
        collection: "audio_chunks",
        query,
        options: { sort: { start: 1 } },
        batchSize,
      }) as { cursorId: string; data: any[]; hasMore: boolean };

      cursorId = firstBatch.cursorId || null;
      hasMore = firstBatch.hasMore;
      pendingChunks = [...firstBatch.data];

      while (pendingChunks.length > 0 || hasMore || streamBuffer.length > 0) {
        // Flush buffer first to keep streaming
        flushBuffer();

        // Process pending chunks
        while (pendingChunks.length > 0) {
          // Check if we need to wait - don't buffer more than 1 minute ahead
          const bufferedSpan = getBufferedTimeSpan();
          if (bufferedSpan >= MAX_BUFFER_AHEAD_SECONDS) {
            flushBuffer();
            // Wait a bit if we're still too far ahead
            if (getBufferedTimeSpan() >= MAX_BUFFER_AHEAD_SECONDS) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              continue;
            }
          }

          const chunk = pendingChunks.shift()!;
          const chunkStart = new Date(chunk.start).getTime();

          // Handle MongoDB Binary object or Uint8Array
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
            const chunkEnd = chunkStart + chunkDurationSeconds * 1000;

            // Skip if chunk ends before start or starts after end
            if (chunkEnd <= startDate.getTime()) {
              continue;
            }
            if (endTime && chunkStart >= endTime) {
              pendingChunks = [];
              hasMore = false;
              break;
            }

            // Handle gap or overlap before this chunk
            if (chunkStart > currentTime) {
              // Gap: insert silence
              const gapSeconds = (chunkStart - currentTime) / 1000;
              const silence = createSilence(gapSeconds);
              addToBuffer(currentTime, silence);
              currentTime = chunkStart;
            } else if (chunkStart < currentTime && streamBuffer.length > 0) {
              // Overlap: trim the last buffered chunk that overlaps
              const overlapSeconds = (currentTime - chunkStart) / 1000;
              const overlapSamples = Math.floor(overlapSeconds * SAMPLE_RATE);
              const overlapBytes = overlapSamples * 2;
              // Find the last item that might overlap
              for (let i = streamBuffer.length - 1; i >= 0; i--) {
                const item = streamBuffer[i];
                if (item.endTime > chunkStart) {
                  // This item overlaps, trim it
                  const itemDurationSeconds = item.data.length / BYTES_PER_SECOND;
                  const newEndTime = chunkStart;
                  const newDurationSeconds = Math.max(0, (newEndTime - item.startTime) / 1000);
                  const newLength = Math.floor(newDurationSeconds * BYTES_PER_SECOND);
                  if (newLength < item.data.length) {
                    const trimmed = item.data.slice(0, newLength);
                    streamBuffer[i] = {
                      startTime: item.startTime,
                      endTime: newEndTime,
                      data: trimmed,
                    };
                  }
                  break;
                }
              }
            }

            // Clip chunk to time boundaries
            let clipStart = 0;
            let clipEnd = pcmData.length;

            if (chunkStart < startDate.getTime()) {
              const offsetSamples = Math.floor(
                (startDate.getTime() - chunkStart) / 1000 * SAMPLE_RATE,
              );
              clipStart = offsetSamples * 2;
            }

            if (endTime && chunkEnd > endTime) {
              const offsetSamples = Math.floor(
                (endTime - chunkStart) / 1000 * SAMPLE_RATE,
              );
              clipEnd = offsetSamples * 2;
            }

            if (clipStart < clipEnd) {
              const clippedPcm = pcmData.slice(clipStart, clipEnd);
              addToBuffer(chunkStart + (clipStart / 2 / SAMPLE_RATE) * 1000, clippedPcm);
              currentTime = chunkStart + (clipEnd / 2 / SAMPLE_RATE) * 1000;
            }
          } catch (error) {
            console.warn(
              `Failed to decode chunk ${chunk._id}: ${error instanceof Error ? error.message : String(error)}`,
            );
            continue;
          }

          // Flush buffer periodically
          flushBuffer();
        }

        // Fetch next batch if needed and we're not too far ahead
        if (hasMore && cursorId && cursorId !== "") {
          const bufferedSpan = getBufferedTimeSpan();
          if (bufferedSpan < MAX_BUFFER_AHEAD_SECONDS) {
            const nextBatch = await mongoResource({
              action: "getMore",
              collection: "audio_chunks",
              cursorId,
              batchSize,
            }) as { data: any[]; hasMore: boolean };

            pendingChunks.push(...nextBatch.data);
            hasMore = nextBatch.hasMore;
          } else {
            // Wait a bit before fetching more
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      }

      // Flush remaining buffer
      flushBuffer();

      // Add silence if we haven't reached the end time
      if (endTime && currentTime < endTime) {
        const remainingSeconds = (endTime - currentTime) / 1000;
        const silence = createSilence(remainingSeconds);
        res.write(silence);
        totalPcmSize += silence.length;
      } else if (!endTime && totalPcmSize === 0) {
        // No end time and no chunks - stream minimal silence
        const silence = createSilence(0.1);
        res.write(silence);
        totalPcmSize += silence.length;
      }

      res.end();
    } catch (error) {
      console.error("Error streaming audio:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
        });
      } else {
        res.end();
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return;
    }
    console.error("Error in /api/audio/stream:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
