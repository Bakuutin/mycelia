// Set DENO_ENV to test to use shorter debounce
Deno.env.set("DENO_ENV", "test");

import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "bson";
import transcription_sequence_creator from "#/workers/transcription_sequence_creator.ts";

Deno.test(
  "Sequence Creator - Single chunk with neighbor (index-1)",
  withFixtures([
    "Admin",
    "Mongo",
    "Migrations",
    "MockCallResourceSDK",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId = new ObjectId();

    // Insert chunk 4 (NO SPEECH)
    await mongoResource({
      action: "insertOne",
      collection: "audio_chunks",
      doc: {
        _id: new ObjectId(),
        original_id: originalId,
        index: 4,
        start: new Date(Date.now()),
        vad: { has_speech: false },
        data: new Uint8Array([0]),
      },
    });

    // Insert chunk 5 (HAS SPEECH)
    const chunk5Id = new ObjectId();
    const chunk5Start = new Date(Date.now() + 10000);
    await mongoResource({
      action: "insertOne",
      collection: "audio_chunks",
      doc: {
        _id: chunk5Id,
        original_id: originalId,
        index: 5,
        start: chunk5Start,
        vad: { has_speech: true },
        data: new Uint8Array([0]),
      },
    });

    // Run worker
    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    // Verify: Should create 1 sequence with 2 chunks (4 and 5)
    const sequences = await db.collection("transcription_sequences").find({}).toArray();
    expect(sequences.length).toBe(1);
    expect(sequences[0].fromIndex).toBe(4);
    expect(sequences[0].toIndex).toBe(5);
    expect(sequences[0].chunk_count).toBe(2);
    
    // Start time should be estimated (chunk5Start - 10s)
    const expectedStart = new Date(chunk5Start.getTime() - 10000);
    expect(sequences[0].start.getTime()).toBe(expectedStart.getTime());

    // Both chunks should be marked with sequence ID
    const markedChunks = await db.collection("audio_chunks")
      .find({ transcription_sequence_id: sequences[0]._id })
      .toArray();
    expect(markedChunks.length).toBe(2);
    
    const indices = markedChunks.map((c: any) => c.index).sort();
    expect(indices).toEqual([4, 5]);
  }),
);

Deno.test(
  "Sequence Creator - Single chunk at index 0 (no neighbor)",
  withFixtures([
    "Admin",
    "Mongo",
    "Migrations",
    "MockCallResourceSDK",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId = new ObjectId();

    // Insert chunk 0 (HAS SPEECH)
    await mongoResource({
      action: "insertOne",
      collection: "audio_chunks",
      doc: {
        _id: new ObjectId(),
        original_id: originalId,
        index: 0,
        start: new Date(Date.now()),
        vad: { has_speech: true },
        data: new Uint8Array([0]),
      },
    });

    // Run worker
    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    // Verify: Should create 1 sequence with only 1 chunk (0)
    const sequences = await db.collection("transcription_sequences").find({}).toArray();
    expect(sequences.length).toBe(1);
    expect(sequences[0].fromIndex).toBe(0);
    expect(sequences[0].toIndex).toBe(0);
    expect(sequences[0].chunk_count).toBe(1);
  }),
);

