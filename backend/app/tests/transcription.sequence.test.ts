// Set DENO_ENV to test to use shorter debounce
Deno.env.set("DENO_ENV", "test");

import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "mongodb";
import transcription_sequence_creator from "#/workers/transcription_sequence_creator.ts";

/**
 * Test suite for Option A: Overlap chunks appear in BOTH sequences
 *
 * When a sequence reaches 30 chunks:
 * - The full sequence [A...Z] (30 chunks) is created
 * - A continuation sequence starts with chunk A (overlap)
 * - Both sequences contain chunk A for transcription context
 */

Deno.test(
  "Sequence Creator - Basic consecutive chunks",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId = new ObjectId();

    // Insert 5 consecutive chunks
    for (let i = 0; i < 5; i++) {
      await mongoResource({
        action: "insertOne",
        collection: "audio_chunks",
        doc: {
          _id: new ObjectId(),
          original_id: originalId,
          index: i,
          start: new Date(Date.now() + i * 10000),
          vad: { has_speech: true },
          data: new Uint8Array([0]),
        },
      });
    }

    // Run worker
    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    // Verify: Should create 1 sequence with 5 chunks
    const sequences = await db.collection("transcription_sequences").find({}).toArray();
    expect(sequences.length).toBe(1);
    expect(sequences[0].fromIndex).toBe(0);
    expect(sequences[0].toIndex).toBe(4);
    expect(sequences[0].chunk_count).toBe(5);
    expect(sequences[0].state).toBe("ready");
    expect(sequences[0].is_continuation).toBe(false);

    // All chunks should be marked
    const markedChunks = await db.collection("audio_chunks")
      .find({ transcription_sequence_id: { $exists: true } })
      .toArray();
    expect(markedChunks.length).toBe(5);
  }),
);

Deno.test(
  "Sequence Creator - Exactly 30 chunks (no split)",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId = new ObjectId();

    // Insert exactly 30 consecutive chunks [0-29]
    for (let i = 0; i < 30; i++) {
      await mongoResource({
        action: "insertOne",
        collection: "audio_chunks",
        doc: {
          _id: new ObjectId(),
          original_id: originalId,
          index: i,
          start: new Date(Date.now() + i * 10000),
          vad: { has_speech: true },
          data: new Uint8Array([0]),
        },
      });
    }

    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    const sequences = await db.collection("transcription_sequences")
      .find({})
      .sort({ fromIndex: 1 })
      .toArray();

    // Should create exactly 1 sequence
    expect(sequences.length).toBe(1);
    expect(sequences[0].fromIndex).toBe(0);
    expect(sequences[0].toIndex).toBe(29);
    expect(sequences[0].chunk_count).toBe(30);
    expect(sequences[0].state).toBe("ready");

    // All 30 chunks should be marked
    const markedChunks = await db.collection("audio_chunks")
      .find({ transcription_sequence_id: { $exists: true } })
      .toArray();
    expect(markedChunks.length).toBe(30);
  }),
);

Deno.test(
  "Sequence Creator - 31 chunks (split with overlap)",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId = new ObjectId();

    // Insert 31 consecutive chunks [0-30]
    for (let i = 0; i <= 30; i++) {
      await mongoResource({
        action: "insertOne",
        collection: "audio_chunks",
        doc: {
          _id: new ObjectId(),
          original_id: originalId,
          index: i,
          start: new Date(Date.now() + i * 10000),
          vad: { has_speech: true },
          data: new Uint8Array([0]),
        },
      });
    }

    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    const sequences = await db.collection("transcription_sequences")
      .find({})
      .sort({ fromIndex: 1 })
      .toArray();

    // Should create 2 sequences with overlap at chunk 1
    expect(sequences.length).toBe(2);

    // First sequence (continuation): [0-1] (2 chunks, includes overlap at 1)
    expect(sequences[0].fromIndex).toBe(0);
    expect(sequences[0].toIndex).toBe(1);
    expect(sequences[0].chunk_count).toBe(2);
    expect(sequences[0].state).toBe("ready");
    expect(sequences[0].is_continuation).toBe(true);

    // Second sequence (partial): [1-30] (30 chunks)
    expect(sequences[1].fromIndex).toBe(1);
    expect(sequences[1].toIndex).toBe(30);
    expect(sequences[1].chunk_count).toBe(30);
    expect(sequences[1].state).toBe("ready");
    expect(sequences[1].is_continuation).toBe(false);

    // All 31 chunks should be marked
    const markedChunks = await db.collection("audio_chunks")
      .find({ transcription_sequence_id: { $exists: true } })
      .toArray();
    expect(markedChunks.length).toBe(31);

    // Chunk 1 (overlap) should be marked with continuation sequence
    const chunk1 = await db.collection("audio_chunks").findOne({ index: 1 });
    expect(chunk1?.transcription_sequence_id?.toString()).toBe(sequences[0]._id.toString());
  }),
);

Deno.test(
  "Sequence Creator - 60 chunks (two splits with overlaps)",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin, mongo) => {
    const { db} = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId = new ObjectId();

    // Insert 60 consecutive chunks [0-59]
    for (let i = 0; i < 60; i++) {
      await mongoResource({
        action: "insertOne",
        collection: "audio_chunks",
        doc: {
          _id: new ObjectId(),
          original_id: originalId,
          index: i,
          start: new Date(Date.now() + i * 10000),
          vad: { has_speech: true },
          data: new Uint8Array([0]),
        },
      });
    }

    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    const sequences = await db.collection("transcription_sequences")
      .find({})
      .sort({ toIndex: -1 }) // Sort by toIndex descending
      .toArray();

    // Should create 3 sequences (two splits with overlaps)
    expect(sequences.length).toBe(3);

    // First sequence (newest): [30-59] (30 chunks, partial)
    expect(sequences[0].fromIndex).toBe(30);
    expect(sequences[0].toIndex).toBe(59);
    expect(sequences[0].chunk_count).toBe(30);
    expect(sequences[0].state).toBe("ready");
    expect(sequences[0].is_continuation).toBe(false);

    // Second sequence (middle continuation): [1-30] (30 chunks, partial, includes overlap at 30)
    expect(sequences[1].fromIndex).toBe(1);
    expect(sequences[1].toIndex).toBe(30);
    expect(sequences[1].chunk_count).toBe(30);
    expect(sequences[1].state).toBe("ready");
    expect(sequences[1].is_continuation).toBe(true);

    // Third sequence (final continuation): [0-1] (2 chunks, includes overlap at 1)
    expect(sequences[2].fromIndex).toBe(0);
    expect(sequences[2].toIndex).toBe(1);
    expect(sequences[2].chunk_count).toBe(2);
    expect(sequences[2].state).toBe("ready");
    expect(sequences[2].is_continuation).toBe(true);

    // All 60 chunks should be marked
    const markedChunks = await db.collection("audio_chunks")
      .find({ transcription_sequence_id: { $exists: true } })
      .toArray();
    expect(markedChunks.length).toBe(60);

    // Chunk 30 (overlap between first and second) should be marked with second sequence
    const chunk30 = await db.collection("audio_chunks").findOne({ index: 30 });
    expect(chunk30?.transcription_sequence_id?.toString()).toBe(sequences[1]._id.toString());

    // Chunk 1 (overlap between second and third) should be marked with third sequence
    const chunk1 = await db.collection("audio_chunks").findOne({ index: 1 });
    expect(chunk1?.transcription_sequence_id?.toString()).toBe(sequences[2]._id.toString());
  }),
);

Deno.test(
  "Sequence Creator - Gap in indices creates separate sequences",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId = new ObjectId();

    // Insert chunks with a gap: [0,1,2] then gap then [5,6,7]
    for (const i of [0, 1, 2, 5, 6, 7]) {
      await mongoResource({
        action: "insertOne",
        collection: "audio_chunks",
        doc: {
          _id: new ObjectId(),
          original_id: originalId,
          index: i,
          start: new Date(Date.now() + i * 10000),
          vad: { has_speech: true },
          data: new Uint8Array([0]),
        },
      });
    }

    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    const sequences = await db.collection("transcription_sequences")
      .find({})
      .sort({ fromIndex: 1 })
      .toArray();

    // Should create 2 separate sequences
    expect(sequences.length).toBe(2);

    // First sequence: [0-2]
    expect(sequences[0].fromIndex).toBe(0);
    expect(sequences[0].toIndex).toBe(2);
    expect(sequences[0].chunk_count).toBe(3);

    // Second sequence: [5-7]
    expect(sequences[1].fromIndex).toBe(5);
    expect(sequences[1].toIndex).toBe(7);
    expect(sequences[1].chunk_count).toBe(3);
  }),
);

Deno.test(
  "Sequence Creator - Multiple original_ids handled separately",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (admin, mongo) => {
    const { db } = mongo;
    const mongoResource = await getMongoResource(admin);

    await db.createCollection("audio_chunks");
    await db.createCollection("transcription_sequences");

    const originalId1 = new ObjectId();
    const originalId2 = new ObjectId();

    // Insert 3 chunks for each original_id
    for (let i = 0; i < 3; i++) {
      await mongoResource({
        action: "insertOne",
        collection: "audio_chunks",
        doc: {
          _id: new ObjectId(),
          original_id: originalId1,
          index: i,
          start: new Date(Date.now() + i * 10000),
          vad: { has_speech: true },
          data: new Uint8Array([0]),
        },
      });

      await mongoResource({
        action: "insertOne",
        collection: "audio_chunks",
        doc: {
          _id: new ObjectId(),
          original_id: originalId2,
          index: i,
          start: new Date(Date.now() + i * 10000 + 5000),
          vad: { has_speech: true },
          data: new Uint8Array([0]),
        },
      });
    }

    await transcription_sequence_creator.use({
      data: { type: "transcription_sequence_creator" },
      updateProgress: async () => {},
    } as any);

    const sequences = await db.collection("transcription_sequences").find({}).toArray();

    // Should create 2 sequences, one per original_id
    expect(sequences.length).toBe(2);

    const seq1 = sequences.find((s: any) => s.original_id.toString() === originalId1.toString());
    const seq2 = sequences.find((s: any) => s.original_id.toString() === originalId2.toString());

    expect(seq1).toBeDefined();
    expect(seq2).toBeDefined();
    expect(seq1!.chunk_count).toBe(3);
    expect(seq2!.chunk_count).toBe(3);
  }),
);
