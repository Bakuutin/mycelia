import { expect } from "@std/expect";
import { ObjectId } from "bson";
import type { Auth } from "@/lib/auth/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import "./fixtures.ts";

Deno.test(
  "jobs list separates automatic no-op checks before applying the limit",
  withFixtures(["Admin", "Mongo", "JobsResource"], async (
    admin: Auth,
    mongo,
  ) => {
    const now = Date.now();
    await mongo.db.collection("jobs").insertMany([
      {
        _id: new ObjectId(),
        type: "transcription_sequence_creator",
        state: "completed",
        trigger: { type: "auto", reason: "new_speech_chunk" },
        result: { status: "success", processed: 0, hasMore: false },
        createdAt: new Date(now),
        finishedAt: new Date(now),
      },
      {
        _id: new ObjectId(),
        type: "transcription_sequence_creator",
        state: "completed",
        trigger: { type: "manual", reason: "operator check" },
        result: { status: "success", processed: 0, hasMore: false },
        createdAt: new Date(now - 1_000),
        finishedAt: new Date(now - 900),
      },
      {
        _id: new ObjectId(),
        type: "transcription",
        state: "completed",
        trigger: { type: "auto", reason: "sequence_ready" },
        result: { result: "empty", processed: 1, wordCount: 0 },
        createdAt: new Date(now - 2_000),
        finishedAt: new Date(now - 1_900),
      },
      {
        _id: new ObjectId(),
        type: "transcription_sequence_creator",
        state: "completed",
        trigger: { type: "auto", reason: "new_speech_chunk" },
        result: { status: "success", processed: 4, hasMore: false },
        createdAt: new Date(now - 3_000),
        finishedAt: new Date(now - 2_900),
      },
      {
        _id: new ObjectId(),
        type: "transcription_sequence_creator",
        state: "active",
        trigger: { type: "auto", reason: "new_speech_chunk" },
        progress: { processed: 0 },
        createdAt: new Date(now - 4_000),
        startedAt: new Date(now - 3_900),
      },
    ]);

    const jobs = admin.getResource("jobs");
    const types = ["transcription_sequence_creator", "transcription"];
    const statuses = ["active", "completed"] as const;

    const operational = await jobs({
      action: "list",
      view: "operational",
      types,
      statuses: [...statuses],
      limit: 1,
    });
    expect(operational).toHaveLength(1);
    expect(operational[0].trigger.type).toBe("manual");

    const idle = await jobs({
      action: "list",
      view: "idle_auto",
      types,
      statuses: [...statuses],
      limit: 10,
    });
    expect(idle).toHaveLength(1);
    expect(idle[0].trigger).toEqual({
      type: "auto",
      reason: "new_speech_chunk",
    });
    expect(idle[0].result.processed).toBe(0);

    const all = await jobs({
      action: "list",
      types,
      statuses: [...statuses],
      limit: 10,
    });
    expect(all).toHaveLength(5);
  }),
);

Deno.test(
  "jobs stats counts idle automatic runs separately from semantic empty work",
  withFixtures(["Admin", "Mongo", "JobsResource"], async (
    admin: Auth,
    mongo,
  ) => {
    const now = new Date();
    await mongo.db.collection("jobs").insertMany([
      {
        _id: new ObjectId(),
        type: "transcription_sequence_creator",
        state: "completed",
        trigger: { type: "auto" },
        result: { processed: 0 },
        createdAt: now,
      },
      {
        _id: new ObjectId(),
        type: "transcription_sequence_creator",
        state: "completed",
        trigger: { type: "manual" },
        result: { processed: 0 },
        createdAt: now,
      },
      {
        _id: new ObjectId(),
        type: "transcription",
        state: "completed",
        trigger: { type: "auto" },
        result: { result: "empty", processed: 1, wordCount: 0 },
        createdAt: now,
      },
    ]);
    await mongo.db.collection("objects").insertOne({
      _id: new ObjectId(),
      name: "fixture",
    });

    const response = await admin.getResource("jobs")({ action: "stats" });
    const creator = response.stats.find((row: any) =>
      row.type === "transcription_sequence_creator"
    );
    const transcription = response.stats.find((row: any) =>
      row.type === "transcription"
    );

    expect(creator.emptyRuns).toBe(2);
    expect(creator.idleAutoRuns).toBe(1);
    expect(transcription.idleAutoRuns).toBe(0);
  }),
);

Deno.test(
  "jobs provider filter searches beyond 500 newer jobs before the result limit",
  withFixtures(["Admin", "Mongo", "JobsResource"], async (
    admin: Auth,
    mongo,
  ) => {
    const now = Date.now();
    const targetId = new ObjectId();
    await mongo.db.collection("jobs").insertMany([
      ...Array.from({ length: 501 }, (_, index) => ({
        _id: new ObjectId(),
        type: "diarization",
        state: "completed",
        data: {
          routingContext: {
            providerProfileId: "current-gpu",
            providerProfileName: "Current GPU",
          },
        },
        createdAt: new Date(now - index),
        finishedAt: new Date(now - index),
      })),
      {
        _id: targetId,
        type: "diarization",
        state: "completed",
        data: {
          routingContext: {
            providerProfileId: "legacy-gpu",
            providerProfileName: "Legacy GPU",
          },
        },
        createdAt: new Date(now - 10_000),
        finishedAt: new Date(now - 9_000),
      },
    ]);

    const result = await admin.getResource("jobs")({
      action: "list",
      view: "all",
      types: ["diarization"],
      statuses: ["completed"],
      providerProfileId: "legacy-gpu",
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(targetId.toString());
    expect(result[0].routingContext.providerProfileId).toBe("legacy-gpu");
  }),
);
