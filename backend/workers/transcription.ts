import { z } from "zod";
import { ObjectId, Binary} from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { combineChunks } from "@/lib/audio-combiner.ts";
import { filterSegments } from "@/lib/transcription-filters.ts";
import { MAX_SEQUENCE_LENGTH } from "@/lib/transcription-constants.ts";

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

    const processSequence = async (sequence: any) => {
      if (!sequence || sequence.state !== "ready") {
        return { status: "skipped", reason: "Sequence not found or not ready" };
      }

      await job.updateProgress({ stage: "processing", sequenceId: sequence._id.toString() });

      // 2. Mark sequence as processing
      await mongo({
        action: "updateOne",
        collection: "transcription_sequences",
        query: { _id: sequence._id },
        update: { $set: { state: "processing", updatedAt: new Date() } },
      });

      try {
        await job.updateProgress({ stage: "fetching_chunks", sequenceId: sequence._id.toString() });
        // 3. Get all chunks for this sequence using the range
        const chunks = await mongo({
          action: "find",
          collection: "audio_chunks",
          query: { 
            original_id: sequence.original_id,
            index: { $gte: sequence.fromIndex, $lte: sequence.toIndex },
          },
          options: { sort: { index: 1 } },
        }) as any[];

        if (chunks.length === 0) {
          throw new Error("No chunks found for sequence range");
        }

        await job.updateProgress({ stage: "combining_audio", chunkCount: chunks.length });
        // 4. Combine chunks into one audio file
        const combinedAudio = await combineChunks(chunks);

        await job.updateProgress({ stage: "transcribing", audioSize: combinedAudio.length });
        // 5. Call transcription API
        const transcript = await transcriptionResource({
          action: "transcribe",
          file: new Binary(combinedAudio),
          fileName: "combined.wav",
          fileType: "audio/wav",
        });

        // 6. Filter segments
        const segments = (transcript as any).segments || [];
        const filteredSegments = filterSegments(segments);

        if (filteredSegments.length === 0) {
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
        const transcriptionDoc = {
          original: sequence.original_id,
          start: sequence.start,
          duration: duration,
          end: new Date(sequence.start.getTime() + duration * 1000),
          segments: filteredSegments,
          text: filteredSegments.map((s: any) => s.text).join(" "),
          createdAt: new Date(),
        };

        await mongo({
          action: "insertOne",
          collection: "transcriptions",
          doc: transcriptionDoc,
        });

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

        await job.updateProgress({ stage: "completed" });
        return { status: "success", result: "transcribed" };

      } catch (error) {
        console.error(`Transcription failed for sequence ${sequence._id}:`, error);
        
        // Reset sequence state to ready (or error) so it can be retried
        await mongo({
          action: "updateOne",
          collection: "transcription_sequences",
          query: { _id: sequence._id },
          update: { $set: { state: "error", error: error instanceof Error ? error.message : String(error), updatedAt: new Date() } },
        });

        throw error;
      }
    };

    if (sequenceId) {
      const sequence = await mongo({
        action: "findOne",
        collection: "transcription_sequences",
        query: { _id: new ObjectId(sequenceId) },
      }) as any;
      return await processSequence(sequence);
    } else {
      // Process all ready sequences
      const readySequences = await mongo({
        action: "find",
        collection: "transcription_sequences",
        query: { state: "ready" },
        options: { sort: { start: -1 }, limit: 2 },
      }) as any[];

      const hasMore = readySequences.length > 1;


      let processedCount = 0;

      if (readySequences.length > 0) {
        await processSequence(readySequences[0]);
        processedCount++;
      }
      
      
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
    debounceMs: 5000,
  },
};

export default capability;
