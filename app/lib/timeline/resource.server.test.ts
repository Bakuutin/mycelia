import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getTimelineResource, TimelineResource } from "./resource.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";

Deno.test(
  "TimelineResource should handle recalculate action",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    defaultResourceManager.registerResource(new TimelineResource());

    const mongo = await getMongoResource(auth);
    const timeline = await getTimelineResource(auth);

    await mongo({
      action: "insertMany",
      collection: "audio_chunks",
      docs: [
        {
          start: new Date("2024-01-01T00:10:00.000Z"),
          vad: { prob: 0.8, has_speech: true },
        },
      ],
    });

    const result = await timeline({
      action: "recalculate",
      all: false,
      start: new Date("2024-01-01T00:00:00.000Z"),
      end: new Date("2024-01-01T01:00:00.000Z"),
    });

    expect(result.success).toBe(true);

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
  }),
);

Deno.test(
  "TimelineResource should handle ensureIndex action",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    defaultResourceManager.registerResource(new TimelineResource());

    const timeline = await getTimelineResource(auth);

    const result = await timeline({
      action: "ensureIndex",
    });

    expect(result.success).toBe(true);
  }),
);
