import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { SpeakerSegmentsResource } from "./resource.server.ts";

Deno.test(
  "speaker profiles can start empty or be seeded from compatible review segments",
  withFixtures(["Admin", "Mongo"], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const resource = new SpeakerSegmentsResource();

    const draft = await resource.use(
      { action: "create-profile", name: "Andrew" },
      auth,
    ) as any;
    expect(draft.sample_count).toBe(0);
    expect(draft.enrollmentStatus).toBe("needs_samples");
    expect(draft.embedding).toBeUndefined();

    const inserted = await mongo({
      action: "insertMany",
      collection: "diarizations",
      docs: [
        {
          lifecycleStatus: "active",
          embeddingSpaceId: "space-v1",
          embedding: [1, 0],
          start: new Date("2026-08-21T10:00:00Z"),
          end: new Date("2026-08-21T10:00:02Z"),
        },
        {
          lifecycleStatus: "active",
          embeddingSpaceId: "space-v1",
          embedding: [0, 1],
          start: new Date("2026-08-21T10:00:02Z"),
          end: new Date("2026-08-21T10:00:05Z"),
        },
      ],
    }) as { insertedIds: Record<string, unknown> };

    const seeded = await resource.use(
      {
        action: "create-profile-from-segments",
        name: "Belka",
        segmentIds: Object.values(inserted.insertedIds).map(String),
      },
      auth,
    ) as any;
    expect(seeded.sample_count).toBe(0);
    expect(seeded.seed_segment_count).toBe(2);
    expect(seeded.seed_duration).toBe(5);
    expect(seeded.embeddingSpaceId).toBe("space-v1");
    expect(seeded.enrollmentStatus).toBe("seeded_from_review");
    expect(seeded.embedding[0]).toBeCloseTo(Math.SQRT1_2);
    expect(seeded.embedding[1]).toBeCloseTo(Math.SQRT1_2);
  }),
);
