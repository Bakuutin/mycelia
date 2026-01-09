// // Set DENO_ENV to test to use shorter debounce
// Deno.env.set("DENO_ENV", "test");

// import { expect } from "@std/expect";
// import { withFixtures } from "@/tests/fixtures.server.ts";
// import { triggerManager } from "@/lib/jobs/trigger-manager.ts";
// import { getMongoResource } from "@/lib/mongo/core.server.ts";
// import { delay } from "@std/async/delay";
// import { redis } from "@/lib/redis.ts";
// import { ObjectId } from "mongodb";

// Deno.test(
//   "Transcription Triggers - should trigger transcription workers when relevant events occur",
//   withFixtures([
//     "Admin",
//     "Mongo",
//   ], async (admin, mongo) => {
//     const { db } = mongo;
    
//     // Ensure collections exist
//     await db.createCollection("audio_chunks");
//     await db.createCollection("transcription_sequences");
//     await db.collection("transcription_sequences").createIndex({ original_id: 1, state: 1, start: 1 });
//     await db.createCollection("jobs");

//     // Start the trigger manager
//     await triggerManager.start();

//     try {
//       const mongoResource = await getMongoResource(admin);

//       // --- 1. Test transcription_sequence_creator trigger ---
//       console.log("[Test] Inserting speech chunk to trigger sequence creator...");
//       const originalId = new ObjectId();
//       await mongoResource({
//         action: "insertOne",
//         collection: "audio_chunks",
//         doc: {
//           original_id: originalId,
//           index: 0,
//           start: new Date(),
//           data: new Uint8Array([0, 1, 2, 3]),
//           vad: { has_speech: true, ran_at: new Date(), prob: 0.9 }
//           // transcription_sequence_id is missing
//         },
//       });

//       // Mock Redis event for the new chunk
//       const channelChunks = "mycelia:mongo:audio_chunks";
//       await redis.publish(channelChunks, JSON.stringify({
//         event: "mongo.change",
//         data: {
//           operationType: "insert",
//           document: { vad: { has_speech: true } }
//         }
//       }));

//       console.log("[Test] Waiting for transcription_sequence_creator trigger...");
//       await delay(1000); 

//       const creatorJob = await db.collection("jobs").findOne({ type: "transcription_sequence_creator" });
//       expect(creatorJob).not.toBeNull();
//       console.log("[Test] Sequence creator job successfully triggered");

//       // --- 2. Test transcription trigger ---
//       console.log("[Test] Inserting ready sequence to trigger transcription...");
//       await mongoResource({
//         action: "insertOne",
//         collection: "transcription_sequences",
//         doc: {
//           original_id: originalId,
//           chunk_ids: [new ObjectId()],
//           chunk_count: 30,
//           state: "ready",
//           start: new Date(),
//           end: new Date(),
//           createdAt: new Date(),
//           updatedAt: new Date(),
//         },
//       });

//       // Mock Redis event for the ready sequence
//       const channelSequences = "mycelia:mongo:transcription_sequences";
//       await redis.publish(channelSequences, JSON.stringify({
//         event: "mongo.change",
//         data: {
//           operationType: "insert",
//           document: { state: "ready" }
//         }
//       }));

//       console.log("[Test] Waiting for transcription trigger...");
//       await delay(1000);

//       const transcriptionJob = await db.collection("jobs").findOne({ type: "transcription" });
//       expect(transcriptionJob).not.toBeNull();
//       console.log("[Test] Transcription job successfully triggered");

//     } finally {
//       await triggerManager.stop();
//     }
//   }),
// );





