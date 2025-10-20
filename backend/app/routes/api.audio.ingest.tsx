import { ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import {
  createAudioChunk,
  createSourceFile,
  getSourceFile,
  processAudioFile,
} from "@/services/streaming.server.ts";

const audioIngestDataSchema = z.object({
  start: z.string().transform((val) => new Date(val)),
  chunk_number: z.number().int().nonnegative().default(0),
  metadata: z.record(z.string(), z.any()).default({}),
  source_file_id: z.string().transform((val) => new ObjectId(val)).optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticateOr401(request);
  const formData = await request.formData();

  const audioFile = formData.get("audio") as File;
  if (!audioFile || !(audioFile instanceof File)) {
    throw new Response("Audio file is required", { status: 400 });
  }

  if (!audioFile.type.startsWith("audio/")) {
    throw new Response("File must be an audio file", { status: 400 });
  }

  const dataStr = formData.get("data") as string;
  if (!dataStr) {
    throw new Response("Data field is required", { status: 400 });
  }

  let rawData: any;
  try {
    rawData = JSON.parse(dataStr);
  } catch (error) {
    throw new Response("Invalid data JSON", { status: 400 });
  }

  const parseResult = audioIngestDataSchema.safeParse(rawData);
  if (!parseResult.success) {
    const errorMessages = parseResult.error.errors.map((err) =>
      `${err.path.join(".")}: ${err.message}`
    ).join(", ");
    throw new Response(`Validation error: ${errorMessages}`, { status: 400 });
  }

  const data = parseResult.data;

  if (data.chunk_number > 0 && !data.source_file_id) {
    throw new Response("Source file ID is required for followup chunks", {
      status: 400,
    });
  }

  const expectedDurationMs = data.metadata?.chunk_duration_ms;

  try {
    console.log(`Processing audio from ${auth.principal}: ${audioFile.name}`);
    const { audioData, actualDurationMs } = await processAudioFile(
      audioFile,
      expectedDurationMs,
    );

    let chunkId: ObjectId;
    let startTime: Date;
    let sourceFileId: ObjectId;

    if (data.chunk_number === 0 && !data.source_file_id) {
      startTime = data.start;

      sourceFileId = await createSourceFile(
        startTime,
        audioFile.size,
        audioFile.name,
        data.metadata || {},
        auth.principal,
      );

      chunkId = await createAudioChunk(
        audioData,
        startTime,
        data.chunk_number,
        sourceFileId,
      );
    } else if (data.chunk_number > 0 && data.source_file_id) {
      sourceFileId = data.source_file_id;
      const sourceFile = await getSourceFile(sourceFileId);

      if (!sourceFile) {
        throw new Response("Source file not found", { status: 400 });
      }

      startTime = data.start;

      chunkId = await createAudioChunk(
        audioData,
        startTime,
        data.chunk_number,
        sourceFileId,
      );
    } else {
      throw new Response("Invalid chunk configuration", { status: 400 });
    }

    return Response.json({
      success: true,
      chunk_id: chunkId.toString(),
      source_file_id: sourceFileId.toString(),
      chunk_number: data.chunk_number,
      start_time: startTime.toISOString(),
      file_size: audioData.length,
      streaming: data.metadata?.streaming || data.chunk_number > 0,
      duration_ms: actualDurationMs,
      message: "Audio chunk processed and stored successfully",
    });
  } catch (error) {
    console.error(`Error processing audio for ${auth.principal}:`, error);
    throw new Response(
      `Audio processing failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { status: 500 },
    );
  }
}
