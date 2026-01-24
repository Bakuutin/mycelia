import { z } from "zod";
import { ObjectId, Binary} from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { combineChunks } from "@/lib/audio-combiner.ts";
import { filterSegments } from "@/lib/transcription-filters.ts";
import { MAX_SEQUENCE_LENGTH } from "@/lib/transcription-constants.ts";
import { getTriggerTiming } from "@/lib/jobs/trigger-config.ts";

// Logging helper
const log = (level: string, msg: string, data?: Record<string, unknown>) => {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[TRANSCRIPTION] ${timestamp} ${level}: ${msg}${dataStr}`);
};

export const schema = z.object({
  type: z.literal("transcription"),
  sequenceId: z.string().optional(),
});

const capability: JobCapability = {
  name: "transcription",
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("success"),
    result: z.literal("transcribed").optional(),
    reason: z.string().optional(),
  })),
  policies: [
    { resource: "db/audio_chunks", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "update", effect: "allow" },
    { resource: "db/transcription_sequences", action: "read", effect: "allow" },
    { resource: "db/transcription_sequences", action: "update", effect: "allow" },
    { resource: "db/transcriptions", action: "write", effect: "allow" },
    { resource: "transcription/audio", action: "transcribe", effect: "allow" },
  ],
  maxConcurrency: 1, // Only one transcription at a time to avoid overloading provider
  use: async (job) => {
    const { sequenceId } = job.data as z.infer<typeof schema>;
    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = env.MYCELIA_URL as string;
    const mongo = (input: any) => callResource("mongo", input, { jwt, myceliaUrl });
    const transcriptionResource = (input: any) => callResource("transcription", input, { jwt, myceliaUrl });

    // Core processing logic (assumes state is already "processing")
    const processSequenceCore = async (mongo: any, transcriptionResource: any, job: any, sequence: any, skipStateUpdate = false) => {
      const seqId = sequence?._id?.toString() || "unknown";
      log("INFO", `Processing sequence`, {
        sequenceId: seqId,
        state: sequence?.state,
        chunkCount: sequence?.chunk_count,
        fromIndex: sequence?.fromIndex,
        toIndex: sequence?.toIndex
      });

      await job.updateProgress({ stage: "processing", sequenceId: sequence._id.toString() });

      // Mark sequence as processing (unless already done atomically)
      if (!skipStateUpdate) {
        await mongo({
          action: "updateOne",
          collection: "transcription_sequences",
          query: { _id: sequence._id },
          update: { $set: { state: "processing", updatedAt: new Date() } },
        });
      }

      try {
        await job.updateProgress({ stage: "fetching_chunks", sequenceId: sequence._id.toString() });
        // 3. Get all chunks for this sequence using the range
        log("INFO", `Fetching chunks for sequence`, {
          sequenceId: seqId,
          original_id: sequence.original_id?.toString(),
          fromIndex: sequence.fromIndex,
          toIndex: sequence.toIndex
        });

        const chunks = await mongo({
          action: "find",
          collection: "audio_chunks",
          query: {
            original_id: sequence.original_id,
            index: { $gte: sequence.fromIndex, $lte: sequence.toIndex },
          },
          options: { sort: { index: 1 } },
        }) as any[];

        log("INFO", `Fetched chunks`, { sequenceId: seqId, chunkCount: chunks.length });

        if (chunks.length === 0) {
          log("ERROR", `No chunks found for sequence range`, { sequenceId: seqId });
          throw new Error("No chunks found for sequence range");
        }

        await job.updateProgress({ stage: "combining_audio", chunkCount: chunks.length });
        // 4. Combine chunks into one audio file
        log("INFO", `Combining audio chunks`, { sequenceId: seqId, chunkCount: chunks.length });
        const combinedAudio = await combineChunks(chunks);
        log("INFO", `Audio combined`, { sequenceId: seqId, audioBytes: combinedAudio.length });

        await job.updateProgress({ stage: "transcribing", audioSize: combinedAudio.length });
        // 5. Call transcription API
        // Language can be configured via TRANSCRIPTION_LANGUAGE env var (default: "en")
        // This prevents faster-whisper from failing on language detection with short audio
        const language = env.TRANSCRIPTION_LANGUAGE || "en";
        log("INFO", `Calling transcription API`, {
          sequenceId: seqId,
          audioBytes: combinedAudio.length,
          language,
          myceliaUrl
        });
        const transcriptStart = Date.now();
        const transcript = await transcriptionResource({
          action: "transcribe",
          file: new Binary(combinedAudio),
          fileName: "combined.wav",
          fileType: "audio/wav",
          language,
        });
        const transcriptDuration = Date.now() - transcriptStart;
        log("INFO", `Transcription API returned`, {
          sequenceId: seqId,
          durationMs: transcriptDuration,
          hasSegments: !!(transcript as any)?.segments,
          segmentCount: (transcript as any)?.segments?.length,
          hasText: !!(transcript as any)?.text,
          textLength: (transcript as any)?.text?.length
        });

        // Validate transcript response structure
        if (!transcript || typeof transcript !== "object") {
          throw new Error(`Invalid transcript response: expected object, got ${typeof transcript}`);
        }
        if ("error" in transcript) {
          throw new Error(`Transcription API error: ${(transcript as any).error}`);
        }
        if (!("segments" in transcript) && !("text" in transcript)) {
          throw new Error(`Invalid transcript response: missing segments or text field. Got: ${JSON.stringify(transcript).slice(0, 200)}`);
        }

        // 6. Filter segments
        const segments = (transcript as any).segments || [];
        log("INFO", `Filtering segments`, { sequenceId: seqId, rawSegmentCount: segments.length });
        const filteredSegments = filterSegments(segments);
        log("INFO", `Segments filtered`, {
          sequenceId: seqId,
          rawCount: segments.length,
          filteredCount: filteredSegments.length,
          removedCount: segments.length - filteredSegments.length
        });

        if (filteredSegments.length === 0) {
          log("WARN", `No speech detected after filtering`, { sequenceId: seqId, rawSegmentCount: segments.length });
          await job.updateProgress({ stage: "empty_result" });
          // No speech detected after filtering
          await mongo({
            action: "updateOne",
            collection: "transcription_sequences",
            query: { _id: sequence._id },
            update: { $set: { state: "empty", updatedAt: new Date() } },
          });

          return { status: "success", result: "empty" };
        }

        const duration = filteredSegments[filteredSegments.length - 1].end;
        await job.updateProgress({ stage: "saving_result", duration });

        // 7. Save transcription result
        const transcriptionText = filteredSegments.map((s: any) => s.text).join(" ");
        log("INFO", `Saving transcription`, {
          sequenceId: seqId,
          duration,
          segmentCount: filteredSegments.length,
          textLength: transcriptionText.length,
          textPreview: transcriptionText.slice(0, 100)
        });

        const transcriptionDoc = {
          original: sequence.original_id,
          start: sequence.start,
          duration: duration,
          end: new Date(sequence.start.getTime() + duration * 1000),
          segments: filteredSegments,
          text: transcriptionText,
          createdAt: new Date(),
        };

        await mongo({
          action: "insertOne",
          collection: "transcriptions",
          doc: transcriptionDoc,
        });
        log("INFO", `Transcription saved`, { sequenceId: seqId });

        // 8. Mark chunks as transcribed
        // If it's a full sequence (MAX_SEQUENCE_LENGTH chunks), we don't mark the last chunk as transcribed
        // because it will be the first chunk of the next sequence (for context).
        const isFull = sequence.chunk_count >= MAX_SEQUENCE_LENGTH;
        const chunksToMarkQuery: any = {
          original_id: sequence.original_id,
          index: {
            $gte: sequence.fromIndex,
            $lte: isFull ? sequence.toIndex - 1 : sequence.toIndex
          },
        };

        log("INFO", `Marking chunks as transcribed`, {
          sequenceId: seqId,
          isFull,
          fromIndex: sequence.fromIndex,
          toIndex: isFull ? sequence.toIndex - 1 : sequence.toIndex
        });

        await mongo({
          action: "updateMany",
          collection: "audio_chunks",
          query: chunksToMarkQuery,
          update: { $set: { transcribed_at: new Date() } },
        });

        // 9. Mark sequence as completed
        await mongo({
          action: "updateOne",
          collection: "transcription_sequences",
          query: { _id: sequence._id },
          update: { $set: { state: "completed", updatedAt: new Date() } },
        });

        log("INFO", `Sequence completed successfully`, {
          sequenceId: seqId,
          duration,
          textPreview: transcriptionText.slice(0, 50)
        });

        await job.updateProgress({ stage: "completed" });
        return { status: "success", result: "transcribed" };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        log("ERROR", `Transcription failed`, {
          sequenceId: seqId,
          error: errorMsg,
          stack: errorStack
        });

        // Reset sequence state to ready (or error) so it can be retried
        await mongo({
          action: "updateOne",
          collection: "transcription_sequences",
          query: { _id: sequence._id },
          update: { $set: { state: "error", error: errorMsg, updatedAt: new Date() } },
        });

        throw error;
      }
    };

    // Wrapper that validates and updates state before processing
    const processSequence = async (sequence: any) => {
      // Accept "ready" sequences and "error" sequences (for retry)
      const isProcessable = sequence && (sequence.state === "ready" || sequence.state === "error");
      if (!isProcessable) {
        log("WARN", `Sequence not processable`, {
          sequenceId: sequence?._id?.toString(),
          state: sequence?.state
        });
        return { status: "skipped", reason: "Sequence not found or not in processable state" };
      }
      return await processSequenceCore(mongo, transcriptionResource, job, sequence, false);
    };

    if (sequenceId) {
      log("INFO", `Processing specific sequence`, { sequenceId });
      const sequence = await mongo({
        action: "findOne",
        collection: "transcription_sequences",
        query: { _id: new ObjectId(sequenceId) },
      }) as any;
      if (!sequence) {
        log("WARN", `Sequence not found`, { sequenceId });
      }
      return await processSequence(sequence);
    } else {
      // Process all ready sequences
      log("INFO", `Looking for ready sequences`);
      // Atomically claim a sequence by updating state to "processing"
      // This prevents race conditions where multiple jobs process the same sequence
      const sequence = await mongo({
        action: "findOneAndUpdate",
        collection: "transcription_sequences",
        query: {
          $or: [
            { state: "ready" },
            {
              state: "error",
              updatedAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) }
            }
          ]
        },
        update: { $set: { state: "processing", updatedAt: new Date() } },
        options: { sort: { start: -1 }, returnDocument: "before" },
      }) as any;

      // Check if there are more sequences to process
      const remainingCount = await mongo({
        action: "count",
        collection: "transcription_sequences",
        query: { state: "ready" },
      }) as number;
      const hasMore = remainingCount > 0;

      log("INFO", `Claimed sequence`, {
        found: !!sequence,
        sequenceId: sequence?._id?.toString(),
        hasMore,
        remainingCount
      });

      let processedCount = 0;

      if (sequence) {
        // Sequence state is already set to "processing" by findOneAndUpdate
        // Skip the state update in processSequenceCore
        const result = await processSequenceCore(mongo, transcriptionResource, job, sequence, true);
        if (result.status === "success") {
          processedCount++;
        }
      } else {
        log("INFO", `No sequences to process`);
      }

      log("INFO", `Job completed`, { processedCount, hasMore });
      return { status: "success", processed: processedCount, hasMore };
    }
  },
  triggers: {
    sources: [
      {
        channel: "mycelia:mongo:transcription_sequences",
        name: "sequence_ready",
        filter: {
          event: "mongo.change",
          "data.operationType": { $in: ["insert", "update"] },
          "data.document.state": "ready",
        },
      },
    ],
    ...getTriggerTiming("transcription"),
  },
};

export default capability;
