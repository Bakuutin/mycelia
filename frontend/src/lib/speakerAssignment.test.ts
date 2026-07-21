// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildSpeakerAssignmentQuery,
  normalizeSpeakerEmbedding,
} from "./speakerAssignment";

describe("speaker assignment helpers", () => {
  it("targets one segment for a segment-only assignment", () => {
    expect(
      buildSpeakerAssignmentQuery({ id: { $oid: "segment-id" } }, "segment"),
    )
      .toEqual({ _id: { $oid: "segment-id" } });
  });

  it("targets the stable speaker label within one recording", () => {
    expect(buildSpeakerAssignmentQuery({
      id: "segment-id",
      originalId: { $oid: "recording-id" },
      speaker: "SPEAKER_02",
    }, "speaker")).toEqual({
      original_id: { $oid: "recording-id" },
      speaker: "SPEAKER_02",
    });
  });

  it("normalizes a segment embedding before creating a profile", () => {
    expect(normalizeSpeakerEmbedding([3, 4])).toEqual([0.6, 0.8]);
  });
});
