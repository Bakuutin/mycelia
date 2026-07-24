// @vitest-environment node

import { ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import {
  diarizationOverlapsTranscript,
  normalizeObjectId,
} from "./diarization";

describe("normalizeObjectId", () => {
  it("normalizes BSON ObjectIds and EJSON ObjectIds", () => {
    const id = new ObjectId("507f1f77bcf86cd799439011");

    expect(normalizeObjectId(id)).toBe("507f1f77bcf86cd799439011");
    expect(normalizeObjectId({ $oid: id.toHexString() })).toBe(
      "507f1f77bcf86cd799439011",
    );
  });
});

describe("diarizationOverlapsTranscript", () => {
  const originalId = "507f1f77bcf86cd799439011";
  const segment = {
    original_id: new ObjectId(originalId),
    time: new Date("2026-01-01T00:00:10Z"),
    endTime: new Date("2026-01-01T00:00:20Z"),
  };

  it("matches current original_id documents by ObjectId value", () => {
    expect(diarizationOverlapsTranscript({
      original_id: new ObjectId(originalId),
      start: new Date("2026-01-01T00:00:12Z"),
      end: new Date("2026-01-01T00:00:14Z"),
    }, segment)).toBe(true);
  });

  it("supports legacy original documents", () => {
    expect(diarizationOverlapsTranscript({
      original: new ObjectId(originalId),
      start: new Date("2026-01-01T00:00:12Z"),
      end: new Date("2026-01-01T00:00:14Z"),
    }, segment)).toBe(true);
  });

  it("rejects different recordings and non-overlapping boundaries", () => {
    expect(diarizationOverlapsTranscript({
      original_id: new ObjectId(),
      start: new Date("2026-01-01T00:00:12Z"),
      end: new Date("2026-01-01T00:00:14Z"),
    }, segment)).toBe(false);

    expect(diarizationOverlapsTranscript({
      original_id: new ObjectId(originalId),
      start: segment.endTime,
      end: new Date("2026-01-01T00:00:21Z"),
    }, segment)).toBe(false);
  });
});
