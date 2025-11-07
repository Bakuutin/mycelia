import { expect, fn } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { Policy } from "@/lib/auth/resources.ts";
import { getMongoResource, MongoResource } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "mongodb";
import {
  fetchTimelineData,
  getDaysAgo,
  type Resolution,
  updateHistogram,
} from "./timeline.server.ts";
import { type Timestamp } from "@/types/timeline.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";

Deno.test(
  "fetchTimelineData should return correct structure",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    await mongo({
      action: "insertOne",
      collection: "histogram_5min",
      doc: {
        start: new Date("2024-01-01T00:00:00.000Z"),
        totals: {
          audio_chunks: { count: 10, speech_probability_max: 0.8 },
          diarizations: { count: 2 },
        },
      },
    });
    await mongo({
      action: "insertOne",
      collection: "transcriptions",
      doc: {
        start: new Date("2024-01-01T00:00:00.000Z"),
        end: new Date("2024-01-01T00:05:00.000Z"),
        segments: [
          {
            start: 0,
            end: 2.5,
            text: "Hello world",
            no_speech_prob: 0.1,
          },
          {
            start: 2.5,
            end: 5.0,
            text: "How are you?",
            no_speech_prob: 0.05,
          },
        ],
        top_language_probs: [{ language: "en", probability: 0.9 }],
      },
    });

    const start = new Date("2024-01-01T00:00:00.000Z").getTime() as Timestamp;
    const end = new Date("2024-01-01T01:00:00.000Z").getTime() as Timestamp;
    const resolution: Resolution = "5min";

    const result = await fetchTimelineData(auth, start, end, resolution);

    expect(result).toBeDefined();
    expect(result.start).toBeInstanceOf(Date);
    expect(result.end).toBeInstanceOf(Date);
    expect(Array.isArray(result.items)).toBe(true);

    // Check items structure
    expect(result.items.length).toBeGreaterThan(0);
    const item = result.items[0];
    expect(item.id).toBeDefined();
    expect(item.start).toBeInstanceOf(Date);
    expect(item.end).toBeInstanceOf(Date);
    expect(item.totals).toBeDefined();
    expect(item.totals.seconds).toBeDefined();
  }),
);


Deno.test(
  "updateHistogram should process audio_chunks data correctly",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);

    const startTime = new Date("2024-01-01T00:00:00.000Z");
    const endTime = new Date("2024-01-01T01:00:00.000Z");

    await mongo({
      action: "insertMany",
      collection: "audio_chunks",
      docs: [
        {
          start: new Date("2024-01-01T00:10:00.000Z"),
          vad: { prob: 0.8, has_speech: true },
        },
        {
          start: new Date("2024-01-01T00:20:00.000Z"),
          vad: { prob: 0.6, has_speech: true },
        },
        {
          start: new Date("2024-01-01T00:30:00.000Z"),
          vad: { prob: 0.3, has_speech: false },
        },
      ],
    });

    await updateHistogram(auth, startTime, endTime, "5min");

    const histogramData = await mongo({
      action: "find",
      collection: "histogram_5min",
      query: {
        start: { $gte: startTime, $lte: endTime },
      },
    });

    expect(histogramData.length).toBeGreaterThan(0);

    const hasAudioData = histogramData.some((doc: any) =>
      doc.totals?.audio_chunks?.count > 0
    );
    expect(hasAudioData).toBe(true);
  }),
);

Deno.test(
  "updateHistogram should make histogram non-stale",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);

    const startTime = new Date("2024-01-01T00:00:00.000Z");
    const endTime = new Date("2024-01-01T01:00:00.000Z");

    await mongo({
      action: "insertOne",
      collection: "histogram_5min",
      doc: {
        start: new Date("2024-01-01T00:10:00.000Z"),
        stale: true,
        totals: { audio_chunks: { count: 1 } },
      },
    });

    await mongo({
      action: "insertOne",
      collection: "audio_chunks",
      doc: {
        start: new Date("2024-01-01T00:10:00.000Z"),
        vad: { prob: 0.8, has_speech: true },
      },
    });

    const beforeUpdate = await mongo({
      action: "findOne",
      collection: "histogram_5min",
      query: { start: new Date("2024-01-01T00:10:00.000Z") },
    });
    expect(beforeUpdate.stale).toBe(true);

    await updateHistogram(auth, startTime, endTime, "5min");

    const afterUpdate = await mongo({
      action: "findOne",
      collection: "histogram_5min",
      query: { start: new Date("2024-01-01T00:10:00.000Z") },
    });
    expect(afterUpdate.stale).toBe(false);
  }),
);
