import { ObjectId } from "mongodb";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getTimelineResource } from "@/lib/timeline/resource.server.ts";

export interface AudioChunk {
  _id?: ObjectId;
  format: string;
  original_id?: ObjectId;
  index: number;
  ingested_at: Date;
  start: Date;
  data: Uint8Array;
}

export interface SourceFile {
  _id: ObjectId;
  start: Date;
  size?: number;
  extension: string;
  ingested: boolean;
  importer: string;
  platform: {
    system: string;
    node: string;
  };
  metadata: Record<string, any>;
  processing_status: string;
  storage_key?: string;
  created_by: string;
}

export async function createSourceFile(
  startTime: Date,
  fileSize: number | undefined,
  filename: string,
  metadata: Record<string, any>,
  createdBy: string,
): Promise<ObjectId> {
  const auth = await getServerAuth();
  const mongoResource = await auth.getResource("tech.mycelia.mongo");

  const extension = filename.split(".").pop() || "unknown";

  const sourceFile: Omit<SourceFile, "_id"> = {
    start: startTime,
    size: fileSize,
    extension,
    ingested: false,
    importer: "streaming_api",
    platform: {
      system: "api",
      node: "web",
    },
    metadata,
    processing_status: "streaming",
    created_by: createdBy,
  };

  const result = await mongoResource({
    action: "insertOne",
    collection: "source_files",
    doc: { ...sourceFile, _id: new ObjectId() },
  }) as { insertedId: ObjectId };

  console.log(
    `Source file created: ${result.insertedId}, start: ${startTime.toISOString()}, size: ${fileSize} bytes`,
  );
  return result.insertedId;
}

export async function getSourceFile(
  sourceFileId: ObjectId,
): Promise<SourceFile | null> {
  const auth = await getServerAuth();
  const mongoResource = await auth.getResource("tech.mycelia.mongo");

  return await mongoResource({
    action: "findOne",
    collection: "source_files",
    query: { _id: sourceFileId },
  }) as SourceFile | null;
}

export async function processAudioFile(
  audioFile: File,
  expectedDurationMs?: number,
): Promise<{ audioData: Uint8Array; actualDurationMs: number }> {
  console.log(
    `Processing audio file: ${audioFile.name}, size: ${audioFile.size} bytes`,
  );

  const tempInputPath = await Deno.makeTempFile({
    suffix: `.${audioFile.name.split(".").pop()}`,
  });
  const tempOutputPath = await Deno.makeTempFile({ suffix: ".opus" });

  try {
    const inputData = new Uint8Array(await audioFile.arrayBuffer());
    await Deno.writeFile(tempInputPath, inputData);

    const ffmpegArgs = [
      "-i",
      tempInputPath,
      "-acodec",
      "libopus",
      "-b:a",
      "64k",
      "-map_metadata",
      "-1",
      "-y",
      tempOutputPath,
    ];

    console.log(`Running FFmpeg: ffmpeg ${ffmpegArgs.join(" ")}`);

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
      throw new Error(`FFmpeg conversion failed: ${errorOutput}`);
    }

    await child.stderr.cancel();
    await child.stdout.cancel();

    const audioData = await Deno.readFile(tempOutputPath);

    const durationArgs = [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      tempOutputPath,
    ];

    const durationProcess = new Deno.Command("ffprobe", {
      args: durationArgs,
      stdout: "piped",
      stderr: "piped",
    });

    const durationChild = durationProcess.spawn();
    const durationStatus = await durationChild.status;

    let actualDurationMs = 0;
    if (durationStatus.success) {
      const stdoutReader = durationChild.stdout.getReader();
      const stdout = await stdoutReader.read();
      const durationStr = new TextDecoder().decode(
        stdout.value || new Uint8Array(),
      ).trim();
      actualDurationMs = Math.round(parseFloat(durationStr) * 1000);
      stdoutReader.releaseLock();
    }

    await durationChild.stderr.cancel();
    await durationChild.stdout.cancel();

    console.log(
      `Audio processed: ${audioData.length} bytes, duration: ${actualDurationMs}ms`,
    );

    if (expectedDurationMs !== undefined) {
      const toleranceMs = 10;
      if (Math.abs(actualDurationMs - expectedDurationMs) > toleranceMs) {
        console.warn(
          `Duration mismatch: expected ${expectedDurationMs}ms, got ${actualDurationMs}ms`,
        );
      }
    }

    return {
      audioData,
      actualDurationMs,
    };
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

export async function invalidateTimelineForData(
  auth: any,
  startTime: Date,
  endTime?: Date,
): Promise<void> {
  try {
    const timeline = await getTimelineResource(auth);
    const invalidateEnd = endTime || new Date(startTime.getTime() + 60000);
    await timeline({
      action: "invalidate",
      start: startTime,
      end: invalidateEnd,
    });
    console.log(
      `Timeline invalidated for range: ${startTime.toISOString()} - ${invalidateEnd.toISOString()}`,
    );
  } catch (error) {
    console.warn(`Timeline invalidation failed: ${error}`);
  }
}

async function convertPcmToOpus(audioData: Uint8Array): Promise<Uint8Array> {
  const tempInputPath = await Deno.makeTempFile({ suffix: ".pcm" });
  const tempOutputPath = await Deno.makeTempFile({ suffix: ".opus" });
  try {
    await Deno.writeFile(tempInputPath, audioData);
    const process = new Deno.Command("ffmpeg", {
      args: ["-i", tempInputPath, "-c:a", "libopus", "-b:a", "64k", "-map_metadata", "-1", tempOutputPath],
    });
    const child = process.spawn();
    const status = await child.status;
    if (!status.success) {
      throw new Error("Failed to convert PCM to Opus");
    }
    const outputData = await Deno.readFile(tempOutputPath);
    return outputData;
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

export async function createAudioChunk(
  audioData: Uint8Array,
  startTime: Date,
  index: number,
  originalId: ObjectId,
  format: "opus" | "pcm" | "float32" = "opus",
): Promise<ObjectId> {

  if (format !== "opus") {

    // debug: save to file
    await Deno.writeFile(
      `debug.pcm`,
      audioData,
    );

    return new ObjectId(); // debug
    // audioData = await convertPcmToOpus(audioData);
  }

  const auth = await getServerAuth();
  const mongoResource = await auth.getResource("tech.mycelia.mongo");

  const chunk: AudioChunk = {
    format: "opus",
    original_id: originalId,
    index,
    ingested_at: new Date(),
    start: startTime,
    data: audioData,
  };

  const result = await mongoResource({
    action: "insertOne",
    collection: "audio_chunks",
    doc: chunk,
  }) as { insertedId: ObjectId };

  console.log(
    `Audio chunk created: ${result.insertedId}, index: ${index}, start: ${startTime.toISOString()}, size: ${audioData.length} bytes${
      originalId ? `, original_id: ${originalId}` : ""
    }`,
  );

  await invalidateTimelineForData(auth, startTime);
  return result.insertedId;
}

export async function getSessionChunks(
  sessionId: string,
): Promise<AudioChunk[]> {
  const auth = await getServerAuth();
  const mongoResource = await auth.getResource("tech.mycelia.mongo");

  return await mongoResource({
    action: "find",
    collection: "audio_chunks",
    query: { session_id: sessionId },
    options: { sort: { index: 1 } },
  }) as AudioChunk[];
}

export async function insertTranscriptionWithInvalidation(
  transcriptionData: any,
  startTime: Date,
  endTime?: Date,
): Promise<ObjectId> {
  const auth = await getServerAuth();
  const mongoResource = await auth.getResource("tech.mycelia.mongo");

  const result = await mongoResource({
    action: "insertOne",
    collection: "transcriptions",
    doc: transcriptionData,
  }) as { insertedId: ObjectId };

  console.log(
    `Transcription created: ${result.insertedId}, start: ${startTime.toISOString()}`,
  );

  await invalidateTimelineForData(auth, startTime, endTime);
  return result.insertedId;
}

export async function insertDiarizationWithInvalidation(
  diarizationData: any,
  startTime: Date,
  endTime?: Date,
): Promise<ObjectId> {
  const auth = await getServerAuth();
  const mongoResource = await auth.getResource("tech.mycelia.mongo");

  const result = await mongoResource({
    action: "insertOne",
    collection: "diarizations",
    doc: diarizationData,
  }) as { insertedId: ObjectId };

  console.log(
    `Diarization created: ${result.insertedId}, start: ${startTime.toISOString()}`,
  );

  await invalidateTimelineForData(auth, startTime, endTime);
  return result.insertedId;
}
