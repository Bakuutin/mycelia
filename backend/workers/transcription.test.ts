import { expect } from "@std/expect";
import transcription, {
  aggregateBatchTranscriptionResult,
  buildTranscribedChunkQuery,
  buildTranscriptionSequenceClaimQuery,
} from "./transcription.ts";

Deno.test("batch result remains transcribed when its final sequence is empty", () => {
  const transcribed = {
    status: "success",
    result: "transcribed",
    transcriptionId: "saved-transcription",
    wordCount: 42,
    textLength: 240,
    segmentCount: 7,
    audioSize: 1024,
    textPreview: "Saved speech",
  };
  const empty = {
    status: "success",
    result: "empty",
    transcriptionId: null,
    wordCount: 0,
    textLength: 0,
    segmentCount: 0,
    audioSize: 0,
  };

  expect(aggregateBatchTranscriptionResult(empty, [transcribed, empty]))
    .toMatchObject({
      result: "transcribed",
      transcriptionId: "saved-transcription",
      wordCount: 42,
      textLength: 240,
      segmentCount: 7,
      audioSize: 1024,
      textPreview: "Saved speech",
    });
});

Deno.test("batch result stays empty when no sequence saved a transcription", () => {
  const empty = {
    status: "success",
    result: "empty",
    processed: 1,
    transcriptionId: null,
    wordCount: 0,
    segmentCount: 0,
  };

  expect(aggregateBatchTranscriptionResult(empty, [empty, empty])).toEqual(
    empty,
  );
});

Deno.test("sequence claiming recovers stale processing work", () => {
  const now = new Date("2026-08-13T00:00:00.000Z");
  expect(buildTranscriptionSequenceClaimQuery(now)).toEqual({
    $or: [
      { state: "ready" },
      {
        state: "error",
        updatedAt: { $lt: new Date("2026-08-12T23:30:00.000Z") },
      },
      {
        state: "processing",
        updatedAt: { $lt: new Date("2026-08-12T23:30:00.000Z") },
      },
    ],
  });
});

Deno.test("automatic transcription preflight uses the claim query", async () => {
  const calls: any[] = [];
  const pending = await transcription.hasPendingWork?.({
    mongo: async (input) => {
      calls.push(input);
      return [{ _id: "sequence" }];
    },
    reason: "interval",
  });

  expect(pending).toBe(1);
  expect(calls).toHaveLength(1);
  expect(calls[0].action).toBe("find");
  expect(calls[0].query.$or.map((entry: any) => entry.state)).toEqual([
    "ready",
    "error",
    "processing",
  ]);
  expect(calls[0].options.hint).toBe(
    "transcription_sequences_claimable_work_v1",
  );
});

Deno.test("terminal transcription marks only chunks owned by its sequence", () => {
  const id = { toString: () => "sequence-1" };
  expect(buildTranscribedChunkQuery({ _id: id })).toEqual({
    transcription_sequence_id: id,
  });
});
