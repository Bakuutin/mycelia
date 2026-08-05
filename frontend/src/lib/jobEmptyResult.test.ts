// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isEmptyJobResult } from "./jobEmptyResult";
import type { JobInfo } from "@/types/jobs";

function job(partial: Partial<JobInfo>): JobInfo {
  return {
    id: "job-1",
    type: "entity_typing",
    state: "completed",
    ...partial,
  } as JobInfo;
}

describe("isEmptyJobResult", () => {
  it("marks an entity_typing run that classified nothing as empty", () => {
    expect(isEmptyJobResult(job({
      type: "entity_typing",
      result: {
        status: "completed",
        success: true,
        processed: 0,
        classified: 0,
        flagsSet: 0,
        markedOther: 0,
        skipped: 0,
        hasMore: false,
      },
    }))).toBe(true);
  });

  it("keeps an entity_typing run that classified entities non-empty", () => {
    expect(isEmptyJobResult(job({
      type: "entity_typing",
      result: { processed: 12, classified: 12 },
    }))).toBe(false);
  });

  it("does not call a run empty when work was queued but none processed", () => {
    expect(isEmptyJobResult(job({
      type: "tagger",
      result: { processed: 0, total: 25 },
    }))).toBe(false);
  });

  it("does not call a run empty when it reports no processed count", () => {
    expect(isEmptyJobResult(job({
      type: "histRecalculation",
      result: { status: "completed", success: true },
    }))).toBe(false);
  });

  it("ignores jobs that have not completed", () => {
    expect(isEmptyJobResult(job({
      type: "entity_typing",
      state: "active",
      result: { processed: 0 },
    }))).toBe(false);
  });

  it("still recognises the transcription empty markers", () => {
    expect(isEmptyJobResult(job({
      type: "transcription",
      result: { processed: 0 },
    }))).toBe(true);
    expect(isEmptyJobResult(job({
      type: "transcription",
      result: { processed: 1, transcriptionId: "t1", wordCount: 42 },
    }))).toBe(false);
  });

  it("still recognises an empty conversation_extractor run", () => {
    expect(isEmptyJobResult(job({
      type: "conversation_extractor",
      result: { conversationsCreated: 0, chunksProcessed: 0 },
    }))).toBe(true);
  });
});
