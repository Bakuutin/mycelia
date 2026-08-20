import { expect } from "@std/expect";
import {
  apiAudioPipelineSourceDetailsHandler,
  apiAudioPipelineSourcesHandler,
} from "@/routes/api.audio.pipeline.sources.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

Deno.test(
  "recent audio sources: requires authentication",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      apiAudioPipelineSourcesHandler,
      "http://localhost:3000/api/audio/pipeline/sources",
    );
    expect(response.status).toBe(401);
  }),
);

Deno.test(
  "recent audio sources: cursor pages are stable and metadata-only",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (
    headers: HeadersInit,
    { db },
  ) => {
    await db.collection("source_files").insertMany(
      Array.from({ length: 7 }, (_, index) => ({
        path: `/audio/source-${index}.m4a`,
        updatedAt: new Date(Date.UTC(2026, 7, 20, 12, index)),
        start: new Date(Date.UTC(2026, 7, 19, 12, index)),
        ingested: true,
        metadata: { source: "voice_memo" },
      })),
    );

    const firstResponse = await callExpressHandler(
      apiAudioPipelineSourcesHandler,
      "http://localhost:3000/api/audio/pipeline/sources?limit=3",
      { headers },
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    expect(typeof first.nextCursor).toBe("string");
    expect(first.items[0].path).toBe("/audio/source-6.m4a");
    expect(first.items[0].chunks).toBeUndefined();

    const secondResponse = await callExpressHandler(
      apiAudioPipelineSourcesHandler,
      `http://localhost:3000/api/audio/pipeline/sources?limit=3&cursor=${
        encodeURIComponent(first.nextCursor)
      }`,
      { headers },
    );
    expect(secondResponse.status).toBe(200);
    const second = await secondResponse.json();
    expect(second.items).toHaveLength(3);
    expect(second.items[0].path).toBe("/audio/source-3.m4a");
    expect(
      second.items.some((item: any) =>
        first.items.some((previous: any) => previous.id === item.id)
      ),
    ).toBe(false);
  }),
);

Deno.test(
  "recent audio sources: details are bounded and independent",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (
    headers: HeadersInit,
    { db },
  ) => {
    const source = await db.collection("source_files").insertOne({
      path: "/audio/detail.m4a",
      updatedAt: new Date(),
      ingested: true,
    });
    await db.collection("audio_chunks").insertMany([
      {
        original_id: source.insertedId,
        vad: { ran_at: new Date(), has_speech: true },
      },
      { original_id: source.insertedId, vad: { has_speech: false } },
    ]);
    await db.collection("transcriptions").insertMany(
      Array.from({ length: 25 }, (_, index) => ({
        original: source.insertedId,
        start: new Date(Date.UTC(2026, 7, 20, 12, index)),
        end: new Date(Date.UTC(2026, 7, 20, 12, index, 5)),
        segments: [{ text: `segment ${index}` }],
      })),
    );

    const response = await callExpressHandler(
      apiAudioPipelineSourceDetailsHandler,
      `http://localhost:3000/api/audio/pipeline/sources/${source.insertedId}/details`,
      { headers, params: { id: source.insertedId.toString() } },
    );
    expect(response.status).toBe(200);
    const details = await response.json();
    expect(details.chunks).toEqual({
      total: 2,
      vadProcessed: 1,
      withSpeech: 1,
    });
    expect(details.transcriptions.count).toBe(25);
    expect(details.transcriptions.preview).toHaveLength(20);
  }),
);

Deno.test(
  "recent audio sources: rejects invalid cursors and source ids",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const cursorResponse = await callExpressHandler(
      apiAudioPipelineSourcesHandler,
      "http://localhost:3000/api/audio/pipeline/sources?cursor=broken",
      { headers },
    );
    expect(cursorResponse.status).toBe(400);

    const detailResponse = await callExpressHandler(
      apiAudioPipelineSourceDetailsHandler,
      "http://localhost:3000/api/audio/pipeline/sources/not-an-id/details",
      { headers, params: { id: "not-an-id" } },
    );
    expect(detailResponse.status).toBe(400);
  }),
);
