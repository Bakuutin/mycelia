import { expect, fn } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { Policy } from "@/lib/auth/resources.ts";
import { getMongoResource, MongoResource } from "@/lib/mongo/core.server.ts";
import { ObjectId } from "mongodb";
import {
  fetchTimelineData,
  getDaysAgo,
  type Resolution,
} from "./timeline.server.ts";
import { type Timestamp } from "@/types/timeline.ts";
import { withFixtures } from "@/tests/fixtures.server.ts"

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
    expect(Array.isArray(result.transcripts)).toBe(true);

    // Check items structure
    expect(result.items.length).toBeGreaterThan(0);
    const item = result.items[0];
    expect(item.id).toBeDefined();
    expect(item.start).toBeInstanceOf(Date);
    expect(item.end).toBeInstanceOf(Date);
    expect(item.totals).toBeDefined();
    expect(item.totals.seconds).toBeDefined();

    // Check transcripts structure
    expect(result.transcripts.length).toBeGreaterThan(0);
    const transcript = result.transcripts[0];
    expect(transcript.start).toBeInstanceOf(Date);
    expect(transcript.end).toBeInstanceOf(Date);
    expect(transcript.text).toBeDefined();
    expect(transcript.id).toBeDefined();
    expect(transcript.no_speech_prob).toBeDefined();
  }),
);

Deno.test(
  "fetchTimelineData should sort transcripts by start time",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    await mongo({
      action: "insertOne",
      collection: "transcriptions",
      doc: {
        start: new Date("2024-01-01T00:05:00.000Z"),
        end: new Date("2024-01-01T00:10:00.000Z"),
        segments: [
          {
            start: 0,
            end: 2.5,
            text: "Second segment",
            no_speech_prob: 0.1,
          },
        ],
        top_language_probs: [{ language: "en", probability: 0.9 }],
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
            text: "First segment",
            no_speech_prob: 0.1,
          },
        ],
        top_language_probs: [{ language: "en", probability: 0.9 }],
      },
    });

    const start = new Date("2024-01-01T00:00:00.000Z").getTime() as Timestamp;
    const end = new Date("2024-01-01T01:00:00.000Z").getTime() as Timestamp;
    const resolution: Resolution = "5min";

    const result = await fetchTimelineData(auth, start, end, resolution);

    expect(result.transcripts.length).toBeGreaterThan(1);

    // Check that transcripts are sorted by start time
    for (let i = 1; i < result.transcripts.length; i++) {
      const prev = result.transcripts[i - 1];
      const curr = result.transcripts[i];
      expect(prev.start.getTime()).toBeLessThanOrEqual(curr.start.getTime());
    }
  }),
);

Deno.test(
  "fetchTimelineData should handle transcript segments correctly",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    await mongo({
      action: "insertOne",
      collection: "transcriptions",
      doc: {
        start: new Date("2024-01-01T00:00:00.000Z"),
        end: new Date("2024-01-01T00:05:00.000Z"),
        segments: [
          {
            start: 1.0,
            end: 3.0,
            text: "Hello world",
            no_speech_prob: 0.1,
          },
          {
            start: 3.0,
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

    expect(result.transcripts.length).toBe(2); // Two segments

    // Check first segment
    const firstSegment = result.transcripts[0];
    expect(firstSegment.text).toBe("Hello world");
    expect(firstSegment.start.getTime()).toBe(
      new Date("2024-01-01T00:00:01.000Z").getTime(),
    );
    expect(firstSegment.end.getTime()).toBe(
      new Date("2024-01-01T00:00:03.000Z").getTime(),
    );
    expect(firstSegment.no_speech_prob).toBe(0.1);

    // Check second segment
    const secondSegment = result.transcripts[1];
    expect(secondSegment.text).toBe("How are you?");
    expect(secondSegment.start.getTime()).toBe(
      new Date("2024-01-01T00:00:03.000Z").getTime(),
    );
    expect(secondSegment.end.getTime()).toBe(
      new Date("2024-01-01T00:00:05.000Z").getTime(),
    );
    expect(secondSegment.no_speech_prob).toBe(0.05);
  }),
);
