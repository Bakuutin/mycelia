import { expect } from "@std/expect";
import { apiAudioPipelineHandler } from "@/routes/api.audio.pipeline.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

Deno.test(
  "audio pipeline handler: requires authentication",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      apiAudioPipelineHandler,
      "http://localhost:3000/api/audio/pipeline",
    );
    expect(response.status).toBe(401);
  }),
);

Deno.test(
  "audio pipeline handler: returns sessions and stats when authenticated",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (
    headers: HeadersInit,
    { db },
  ) => {
    await db.collection("audio_chunks").insertOne({
      start: new Date("2026-08-13T00:00:00Z"),
      vad: { has_speech: true },
    });
    const response = await callExpressHandler(
      apiAudioPipelineHandler,
      "http://localhost:3000/api/audio/pipeline",
      { headers },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(typeof data.hasMore).toBe("boolean");
    expect(typeof data.stats).toBe("object");
    expect(typeof data.stats.totalSessions).toBe("number");
    expect(typeof data.stats.totalChunks).toBe("number");
    expect(typeof data.stats.chunksVadProcessed).toBe("number");
    expect(typeof data.stats.chunksAwaitingVad).toBe("number");
    expect(typeof data.stats.vadRatePerMinute).toBe("number");
    expect(typeof data.stats.vadJobs).toBe("object");
    expect(typeof data.stats.vadJobs.active).toBe("number");
    expect(typeof data.stats.vadJobs.failed).toBe("number");
    expect(typeof data.stats.transcriptionPendingChunks).toBe("number");
    expect(typeof data.stats.transcriptionPendingMaximumHours).toBe("number");
    expect(typeof data.stats.sourceFiles.total).toBe("number");
    expect(Array.isArray(data.stats.sourceFiles.byKind)).toBe(true);
    expect(data.stats.diarizationCampaign).toBeNull();
    expect(Array.isArray(data.stats.stages)).toBe(true);
    expect(data.stats.stages.map((stage: any) => stage.type)).toEqual([
      "ingestion",
      "vad",
      "transcription_sequence_creator",
      "transcription",
      "conversation_chunk_creator",
      "conversation_extractor_merged",
      "summarization",
      "diarization",
      "speakerMatching",
      "speakerIdentity",
      "enrollment",
    ]);
    expect(
      data.stats.stages.find((stage: any) => stage.type === "diarization")
        ?.backlog,
    ).toBe(1);
    expect(Array.isArray(data.stats.recentJobs)).toBe(true);
  }),
);

Deno.test(
  "audio pipeline handler: returns the current global diarization campaign",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (
    headers: HeadersInit,
    { db },
  ) => {
    await db.collection("diarization_campaigns").insertMany([
      {
        campaignId: "completed-newer",
        mode: "missing",
        status: "completed",
        updatedAt: new Date("2026-08-16T03:00:00Z"),
        processedChunks: 100,
        totalChunks: 100,
      },
      {
        campaignId: "global-running",
        mode: "missing",
        status: "running",
        updatedAt: new Date("2026-08-16T02:00:00Z"),
        processedChunks: 40,
        totalChunks: 100,
        processedSequences: 12,
        segmentsCreated: 84,
        errorCount: 2,
        chunksPerSecond: 0.75,
        etaSeconds: 80,
        batchNumber: 4,
        estimatedBatches: 10,
      },
      {
        campaignId: "file-specific-running",
        mode: "missing",
        status: "running",
        originalId: "source-file-id",
        updatedAt: new Date("2026-08-16T04:00:00Z"),
      },
      {
        campaignId: "generation-running",
        mode: "build_generation",
        status: "running",
        updatedAt: new Date("2026-08-16T05:00:00Z"),
      },
    ]);

    const response = await callExpressHandler(
      apiAudioPipelineHandler,
      "http://localhost:3000/api/audio/pipeline",
      { headers },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.stats.diarizationCampaign).toMatchObject({
      campaignId: "global-running",
      status: "running",
      processedChunks: 40,
      totalChunks: 100,
      pendingChunks: 60,
      processedSequences: 12,
      segmentsCreated: 84,
      errorCount: 2,
      chunksPerSecond: 0.75,
      etaSeconds: 80,
      batchNumber: 4,
      estimatedBatches: 10,
      totalEstimated: false,
    });
  }),
);

Deno.test(
  "audio pipeline handler: respects limit parameter",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      apiAudioPipelineHandler,
      "http://localhost:3000/api/audio/pipeline?limit=5",
      { headers },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sessions.length).toBeLessThanOrEqual(5);
  }),
);

Deno.test(
  "audio pipeline handler: hides cached ingestion error after a successful retry",
  withFixtures(
    ["AdminAuthHeaders", "Mongo"],
    async (headers: HeadersInit, { db }) => {
      await db.collection("source_files").insertOne({
        start: new Date("2026-07-19T09:07:19.053Z"),
        path: "/tmp/retried-voice-memo.m4a",
        platform: { importer: "apple_voicememos" },
        ingested: true,
        ingested_at: new Date("2026-07-25T02:46:21.760Z"),
        ingestion: {
          error: "old ffmpeg failure",
          last_attempt: new Date("2026-07-25T02:20:26.357Z"),
        },
      });

      const response = await callExpressHandler(
        apiAudioPipelineHandler,
        "http://localhost:3000/api/audio/pipeline",
        { headers },
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].ingested).toBe(true);
      // EJSON serializes an omitted optional field as null in the JSON payload.
      expect(data.sessions[0].ingestionError).toBeNull();
      expect(data.stats.sourceFiles.errors).toBe(0);
    },
  ),
);

Deno.test(
  "audio pipeline handler: caps limit at 100 to prevent DoS",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    // Request an absurdly large limit — handler must cap it at 100
    const response = await callExpressHandler(
      apiAudioPipelineHandler,
      "http://localhost:3000/api/audio/pipeline?limit=999999",
      { headers },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    // With an empty DB the result will be empty, but the handler must not crash
    // and must not attempt to fetch more than 101 (limit+1) source files
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(data.sessions.length).toBeLessThanOrEqual(100);
  }),
);

Deno.test(
  "audio pipeline handler: uses default limit of 10 when not specified",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      apiAudioPipelineHandler,
      "http://localhost:3000/api/audio/pipeline",
      { headers },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data.sessions)).toBe(true);
    // Empty DB → 0 sessions, hasMore false
    expect(data.hasMore).toBe(false);
  }),
);
