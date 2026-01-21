import { Db, MongoClient, ObjectId } from "mongodb";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Running migration 0012: Fixing inverted chunk timestamps...");

  const chunksCollection = db.collection("conversation_chunks");
  const transcriptionsCollection = db.collection("transcriptions");

  const emptyChunks = await chunksCollection.find({
    state: "empty",
    transcriptionIds: { $exists: true, $ne: [] },
  }).toArray();

  console.log(`Found ${emptyChunks.length} empty chunks with transcriptions to fix`);

  let fixed = 0;
  let skipped = 0;

  for (const chunk of emptyChunks) {
    const transcriptionIds = chunk.transcriptionIds as ObjectId[];
    
    if (!transcriptionIds || transcriptionIds.length === 0) {
      skipped++;
      continue;
    }

    const transcriptions = await transcriptionsCollection.find(
      { _id: { $in: transcriptionIds } },
      { projection: { start: 1, end: 1 } }
    ).toArray();

    if (transcriptions.length === 0) {
      console.log(`  Chunk ${chunk._id}: no transcriptions found, skipping`);
      skipped++;
      continue;
    }

    let minStart = new Date(transcriptions[0].start);
    let maxEnd = new Date(transcriptions[0].end);

    for (const t of transcriptions) {
      const tStart = new Date(t.start);
      const tEnd = new Date(t.end);
      if (tStart < minStart) minStart = tStart;
      if (tEnd > maxEnd) maxEnd = tEnd;
    }

    const needsFix = chunk.start > chunk.end || 
                     new Date(chunk.start).getTime() !== minStart.getTime() ||
                     new Date(chunk.end).getTime() !== maxEnd.getTime();

    if (needsFix) {
      await chunksCollection.updateOne(
        { _id: chunk._id },
        {
          $set: {
            start: minStart,
            end: maxEnd,
            state: "ready",
          },
          $unset: {
            error: "",
            segmentsFound: "",
            conversationsCreated: "",
            extractionKey: "",
            processedByJobId: "",
            processingStartedAt: "",
          },
        }
      );
      console.log(`  Fixed chunk ${chunk._id}: start=${minStart.toISOString()}, end=${maxEnd.toISOString()}`);
      fixed++;
    } else {
      await chunksCollection.updateOne(
        { _id: chunk._id },
        {
          $set: { state: "ready" },
          $unset: {
            error: "",
            segmentsFound: "",
            conversationsCreated: "",
            extractionKey: "",
            processedByJobId: "",
            processingStartedAt: "",
          },
        }
      );
      console.log(`  Reset chunk ${chunk._id} to ready (timestamps were correct)`);
      fixed++;
    }
  }

  console.log(`Migration complete: fixed=${fixed}, skipped=${skipped}`);
}

export async function down(_db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0012: No automatic rollback for data fixes");
}
