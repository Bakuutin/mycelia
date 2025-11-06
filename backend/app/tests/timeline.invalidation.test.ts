import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getTimelineResource } from "@/lib/timeline/resource.server.ts";
import { ObjectId } from "bson";

Deno.test(
  "Timeline should be automatically invalidated when audio chunk is created",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const timeline = await getTimelineResource(auth);

    const testTime = new Date("2024-01-01T10:00:00.000Z");

    // First create some histogram data
    await timeline({
      action: "recalculate",
      start: testTime,
      end: new Date(testTime.getTime() + 3600000), // 1 hour later
    });

    // Insert some histogram data manually to verify it gets invalidated
    await mongo({
      action: "insertOne",
      collection: "histogram_5min",
      doc: {
        start: testTime,
        totals: { audio_chunks: { count: 10 } },
      },
    });

    // Verify histogram data exists
    const beforeData = await mongo({
      action: "find",
      collection: "histogram_5min",
      query: { start: testTime },
    });
    expect(beforeData.length).toBe(1);

    await mongo({
      action: "insertOne",
      collection: "audio_chunks",
      doc: {
        format: "opus",
        original_id: new ObjectId(),
        source_file_id: new ObjectId(),
        index: 0,
        ingested_at: new Date(),
        start: testTime,
        data: new Uint8Array([1, 2, 3, 4]),
      },
    });

    // Verify histogram data was invalidated (marked as stale)
    const afterData = await mongo({
      action: "find",
      collection: "histogram_5min",
      query: { start: testTime },
    });
    expect(afterData.length).toBe(1);
    expect(afterData[0].stale).toBe(true);
  }),
);
