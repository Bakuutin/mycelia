import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { updateHistogram, updateAllHistogram } from "./histRecalculation.ts";

Deno.test(
  "updateHistogram should create histogram_5min entries from audio_chunks",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);

    await mongo({
      action: "insertMany",
      collection: "audio_chunks",
      docs: [
        {
          start: new Date("2024-01-01T00:10:00.000Z"),
          vad: { prob: 0.8, has_speech: true },
        },
        {
          start: new Date("2024-01-01T00:11:00.000Z"),
          vad: { prob: 0.6, has_speech: true },
        },
        {
          start: new Date("2024-01-01T00:20:00.000Z"),
          vad: { prob: 0.3, has_speech: false },
        },
      ],
    });

    await updateHistogram(
      auth,
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T01:00:00.000Z"),
      "5min",
    );

    const histogramData = await mongo({
      action: "find",
      collection: "histogram_5min",
      query: {
        start: {
          $gte: new Date("2024-01-01T00:00:00.000Z"),
          $lt: new Date("2024-01-01T01:00:00.000Z"),
        },
      },
    });

    expect(histogramData.length).toBeGreaterThan(0);

    const bin10min = histogramData.find(
      (h: any) => h.start.getTime() === new Date("2024-01-01T00:10:00.000Z").getTime()
    );
    expect(bin10min).toBeDefined();
    expect(bin10min.totals.audio_chunks.count).toBe(2);
    expect(bin10min.totals.audio_chunks.has_speech).toBe(2);
    expect(bin10min.totals.audio_chunks.speech_probability_max).toBe(0.8);

    const bin20min = histogramData.find(
      (h: any) => h.start.getTime() === new Date("2024-01-01T00:20:00.000Z").getTime()
    );
    expect(bin20min).toBeDefined();
    expect(bin20min.totals.audio_chunks.count).toBe(1);
    expect(bin20min.totals.audio_chunks.has_speech).toBe(0);
  }),
);

Deno.test(
  "updateHistogram should aggregate transcriptions",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);

    await mongo({
      action: "insertMany",
      collection: "transcriptions",
      docs: [
        { start: new Date("2024-01-01T00:05:00.000Z"), text: "hello" },
        { start: new Date("2024-01-01T00:06:00.000Z"), text: "world" },
        { start: new Date("2024-01-01T00:15:00.000Z"), text: "test" },
      ],
    });

    await updateHistogram(
      auth,
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T01:00:00.000Z"),
      "5min",
    );

    const histogramData = await mongo({
      action: "find",
      collection: "histogram_5min",
      query: {
        start: {
          $gte: new Date("2024-01-01T00:00:00.000Z"),
          $lt: new Date("2024-01-01T01:00:00.000Z"),
        },
      },
    });

    const bin5min = histogramData.find(
      (h: any) => h.start.getTime() === new Date("2024-01-01T00:05:00.000Z").getTime()
    );
    expect(bin5min).toBeDefined();
    expect(bin5min.totals.transcriptions.count).toBe(2);

    const bin15min = histogramData.find(
      (h: any) => h.start.getTime() === new Date("2024-01-01T00:15:00.000Z").getTime()
    );
    expect(bin15min).toBeDefined();
    expect(bin15min.totals.transcriptions.count).toBe(1);
  }),
);

Deno.test(
  "updateAllHistogram should create histograms for all resolutions",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);

    await mongo({
      action: "insertMany",
      collection: "audio_chunks",
      docs: [
        {
          start: new Date("2024-01-01T00:10:00.000Z"),
          vad: { prob: 0.8, has_speech: true },
        },
        {
          start: new Date("2024-01-01T02:30:00.000Z"),
          vad: { prob: 0.5, has_speech: true },
        },
      ],
    });

    await updateAllHistogram(
      auth,
      new Date("2024-01-01T00:00:00.000Z"),
      new Date("2024-01-01T04:00:00.000Z"),
    );

    const histogram5min = await mongo({
      action: "find",
      collection: "histogram_5min",
      query: {},
    });
    expect(histogram5min.length).toBeGreaterThan(0);

    const histogram1hour = await mongo({
      action: "find",
      collection: "histogram_1hour",
      query: {},
    });
    expect(histogram1hour.length).toBeGreaterThan(0);

    const histogram1day = await mongo({
      action: "find",
      collection: "histogram_1day",
      query: {},
    });
    expect(histogram1day.length).toBeGreaterThan(0);
  }),
);
