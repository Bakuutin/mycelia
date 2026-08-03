import { expect } from "@std/expect";
import { aggregateBatchTranscriptionResult } from "./transcription.ts";

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

  expect(aggregateBatchTranscriptionResult(empty, [empty, empty])).toEqual(empty);
});
