// Set DENO_ENV to test to use shorter debounce
Deno.env.set("DENO_ENV", "test");

import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "mongodb";
import transcription_sequence_creator from "@/workers/transcription_sequence_creator.ts";
import { join } from "@std/path";
import { EJSON } from "bson";

Deno.test(
  "Transcription Sequence Creator - match split logic from python version using raw chunks",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    // Ensure collections exist
    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    // 1. Read the expected sequences JSON data to know which chunks to include
    const sttPath = join(Deno.cwd(), "..", "python", "python.stt.json");
    const expectedSequencesRaw = EJSON.parse(await Deno.readTextFile(sttPath)) as any[];

    const chunkIdsInExpected = new Set<string>();
    for (const seq of expectedSequencesRaw) {
      for (const chunk of seq.chunks) {
        chunkIdsInExpected.add(chunk._id.toString());
      }
    }

    // 2. Read the raw chunks JSON data and filter
    const chunksPath = join(Deno.cwd(), "..", "python", "audio_chunks.json");
    const rawChunks = EJSON.parse(await Deno.readTextFile(chunksPath)) as any[];

    let insertedCount = 0;
    for (const chunk of rawChunks) {
      if (chunkIdsInExpected.has(chunk._id.toString())) {
        // Ensure data field exists
        if (!chunk.data) {
          chunk.data = new Uint8Array([0]);
        }
        
        // Clear sequence ID and transcription status so the worker can process it
        delete chunk.transcription_sequence_id;
        delete chunk.transcribed_at;

        if (chunk.original_id.toString() === "695d29b7ea0645e6ec79dfd3" && (chunk.index === 9 || chunk.index === 10)) {
          console.log(`[Test] Inserting chunk ${chunk.index} for ...dfd3 with start ${chunk.start.toISOString()}`);
        }

        await mongoResource({
          action: "insertOne",
          collection: "audio_chunks",
          doc: chunk,
        });
        insertedCount++;
      }
    }

    console.log(`[Test] Inserted ${insertedCount} raw chunks that are present in expected sequences.`);

    // 3. Run worker in batch mode
    let totalProcessed = 0;
    while (true) {
      const result = await transcription_sequence_creator.use({
        data: { type: "transcription_sequence_creator" },
        updateProgress: async () => {},
      } as any) as any;
      
      if (!result.processed) break;
      totalProcessed += result.processed;
      if (totalProcessed > insertedCount) break; // Safety break
    }

    console.log(`[Test] Worker processed ${totalProcessed} chunks.`);

    // 4. Prepare expected sequences for comparison
    const expectedSequences = expectedSequencesRaw.map((seq: any) => {
      const indices = seq.chunks.map((c: any) => c.index).sort((a: number, b: number) => a - b);
      return {
        original_id: seq.original_id,
        fromIndex: indices[0],
        toIndex: indices[indices.length - 1],
        chunk_count: indices.length
      };
    });

    console.log(`[Test] Expected sequences from Python (${expectedSequences.length} total):`);
    for (let i = 0; i < expectedSequences.length; i++) {
      const seq = expectedSequences[i];
      console.log(`[Test]   ${i}: original_id=...${seq.original_id.toString().slice(-4)} fromIndex=${seq.fromIndex} toIndex=${seq.toIndex} count=${seq.chunk_count}`);
    }

    // 5. Compare results
    const actualSequences = await db.collection("transcription_sequences")
      .find({})
      .sort({ original_id: 1, fromIndex: 1 })
      .toArray();

    // Sort expected sequences similarly
    expectedSequences.sort((a, b) => {
      if (a.original_id.toString() !== b.original_id.toString()) {
        return a.original_id.toString().localeCompare(b.original_id.toString());
      }
      return a.fromIndex - b.fromIndex;
    });

    console.log(`[Test] Comparing ${actualSequences.length} actual sequences against ${expectedSequences.length} expected ones.`);

    for (let i = 0; i < Math.min(actualSequences.length, expectedSequences.length); i++) {
      const actual = actualSequences[i];
      const expected = expectedSequences[i];

      try {
        expect(actual.original_id.toString()).toBe(expected.original_id.toString());
        expect(actual.fromIndex).toBe(expected.fromIndex);
        expect(actual.toIndex).toBe(expected.toIndex);
        expect(actual.chunk_count).toBe(expected.chunk_count);
      } catch (e) {
        console.error(`Mismatch at sequence ${i}:`);
        console.error(`Actual:   `, { id: actual.original_id.toString(), from: actual.fromIndex, to: actual.toIndex, count: actual.chunk_count });
        console.error(`Expected: `, { id: expected.original_id.toString(), from: expected.fromIndex, to: expected.toIndex, count: expected.chunk_count });
        throw e;
      }
    }

    expect(actualSequences.length).toBe(expectedSequences.length);
  }),
);
