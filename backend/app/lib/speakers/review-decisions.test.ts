import { assert, assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import {
  speakerSegmentsRequestSchema,
  stratifyReviewCandidates,
} from "./resource.server.ts";
import {
  applyReviewDecisionRevision,
  attachReviewDecisionSummaries,
  latestReviewAnnotationsBySegment,
  prepareReviewCandidates,
  restoreReviewDecision,
} from "./review-sessions.ts";

const sessionId = "66b000000000000000000050";
const segmentId = "66b000000000000000000001";
const skyProfileId = "66b000000000000000000010";
const otherProfileId = "66b000000000000000000020";

Deno.test("review decision assigns another profile while excluding the calibration target", () => {
  const result = speakerSegmentsRequestSchema.safeParse({
    action: "commit-review-decision",
    sessionId,
    revision: 1,
    clientRequestId: "assign-other-profile",
    segmentIds: [segmentId],
    profileId: otherProfileId,
    excludedProfileIds: [skyProfileId],
  });

  assert(result.success);
  assertEquals(result.data.action, "commit-review-decision");
  if (result.data.action === "commit-review-decision") {
    assertEquals(result.data.profileId, otherProfileId);
    assertEquals(result.data.excludedProfileIds, [skyProfileId]);
  }
});

Deno.test("review decision rejects excluding the assigned profile", () => {
  const result = speakerSegmentsRequestSchema.safeParse({
    action: "commit-review-decision",
    sessionId,
    revision: 1,
    clientRequestId: "contradictory-profile",
    segmentIds: [segmentId],
    profileId: otherProfileId,
    excludedProfileIds: [otherProfileId],
  });

  assertEquals(result.success, false);
});

Deno.test("review revision contract requires the decision being replaced", () => {
  const result = speakerSegmentsRequestSchema.safeParse({
    action: "revise-review-decision",
    sessionId,
    revision: 3,
    clientRequestId: "correct-one-segment",
    segmentIds: [segmentId],
    replacesDecisionId: "66b000000000000000000099",
    profileId: skyProfileId,
    excludedProfileIds: [],
  });

  assert(result.success);
  assertEquals(result.data.action, "revise-review-decision");
});

Deno.test("undo contract carries the session revision", () => {
  const result = speakerSegmentsRequestSchema.safeParse({
    action: "undo-review-decision",
    sessionId,
    revision: 4,
    decisionId: "66b000000000000000000099",
  });

  assert(result.success);
});

Deno.test("review revision changes only selected rows and preserves reviewed state", () => {
  const oldDecisionId = "66b000000000000000000099";
  const newDecisionId = "66b000000000000000000100";
  const window = [
    {
      segmentId,
      groupId: "group-1",
      status: "reviewed",
      decisionId: oldDecisionId,
    },
    {
      segmentId: "66b000000000000000000002",
      groupId: "group-1",
      status: "reviewed",
      decisionId: oldDecisionId,
    },
  ];

  const revised = applyReviewDecisionRevision(window, {
    segmentIds: [segmentId],
    replacesDecisionId: oldDecisionId,
    decisionId: newDecisionId,
  });

  assertEquals(revised, [
    {
      segmentId,
      groupId: "group-1",
      status: "reviewed",
      decisionId: newDecisionId,
    },
    window[1],
  ]);
  assertThrows(
    () =>
      applyReviewDecisionRevision(window, {
        segmentIds: [segmentId],
        replacesDecisionId: "66b000000000000000000098",
        decisionId: newDecisionId,
      }),
    Error,
    "Review decision changed elsewhere",
  );
});

Deno.test("undo refuses a superseded decision and counts only restored rows", () => {
  const oldDecisionId = "66b000000000000000000099";
  const newDecisionId = "66b000000000000000000100";
  const neighborId = "66b000000000000000000002";
  const currentWindow = [
    { segmentId, status: "reviewed", decisionId: newDecisionId },
    { segmentId: neighborId, status: "reviewed", decisionId: oldDecisionId },
  ];

  const restored = restoreReviewDecision(currentWindow, {
    segmentIds: [segmentId, neighborId],
    decisionId: oldDecisionId,
  });
  assertEquals(restored.restoredCount, 1);
  assertEquals(restored.firstRestored, neighborId);
  assertEquals(restored.window, [
    currentWindow[0],
    { segmentId: neighborId, status: "pending", decisionId: null },
  ]);

  assertThrows(
    () =>
      restoreReviewDecision(currentWindow, {
        segmentIds: [segmentId],
        decisionId: oldDecisionId,
      }),
    Error,
    "Review decision is no longer current",
  );
});

Deno.test("review hydration exposes assigned and deleted profile names", () => {
  const assignedDecisionId = "66b000000000000000000099";
  const deletedDecisionId = "66b000000000000000000100";
  const deletedProfileId = "66b000000000000000000030";
  const updatedAt = new Date("2026-08-12T08:00:00.000Z");
  const window = [
    { segmentId, status: "reviewed", decisionId: assignedDecisionId },
    {
      segmentId: "66b000000000000000000002",
      status: "reviewed",
      decisionId: deletedDecisionId,
    },
  ];

  const hydrated = attachReviewDecisionSummaries(window, [
    {
      _id: assignedDecisionId,
      profileId: otherProfileId,
      excludedProfileIds: [skyProfileId],
      source: "review_single",
      updatedAt,
    },
    {
      _id: deletedDecisionId,
      profileId: deletedProfileId,
      excludedProfileIds: [skyProfileId],
      source: "review_single",
      updatedAt,
    },
  ], [
    { _id: skyProfileId, name: "Sky" },
    { _id: otherProfileId, name: "Belka" },
  ]);

  assertEquals(hydrated[0].decisionSummary, {
    decisionId: assignedDecisionId,
    outcome: "assigned",
    profileId: otherProfileId,
    profileName: "Belka",
    excludedProfileIds: [skyProfileId],
    excludedProfileNames: ["Sky"],
    source: "manual",
    updatedAt,
  });
  assertEquals(hydrated[1].decisionSummary?.profileName, "Deleted profile");
});

Deno.test("label counts use only the latest annotation for each segment", () => {
  const latest = latestReviewAnnotationsBySegment([
    {
      segmentId,
      profileId: skyProfileId,
      updatedAt: new Date("2026-08-12T08:00:00Z"),
    },
    {
      segmentId,
      profileId: otherProfileId,
      excludedProfileIds: [skyProfileId],
      updatedAt: new Date("2026-08-12T09:00:00Z"),
    },
  ]);

  assertEquals(latest.length, 1);
  assertEquals(latest[0].profileId, otherProfileId);
});

Deno.test("review windows take candidates across recordings before repeating one", () => {
  const candidates = [
    { _id: "a1", original_id: "recording-a" },
    { _id: "a2", original_id: "recording-a" },
    { _id: "a3", original_id: "recording-a" },
    { _id: "b1", original_id: "recording-b" },
    { _id: "c1", original_id: "recording-c" },
  ];
  const { selected, remaining } = stratifyReviewCandidates(candidates, 3);

  assertEquals(selected.map((item) => item._id), ["a1", "b1", "c1"]);
  assertEquals(remaining.map((item) => item._id), ["a2", "a3"]);
});

Deno.test("clean review candidates exclude sub-second fragments and overlapping duplicates", () => {
  const prepared = prepareReviewCandidates([
    {
      _id: "short",
      original_id: "recording-a",
      runId: "legacy-v0",
      start: new Date("2026-08-12T08:00:00.000Z"),
      end: new Date("2026-08-12T08:00:00.200Z"),
    },
    {
      _id: "contained",
      original_id: "recording-a",
      runId: "legacy-v0",
      start: new Date("2026-08-12T08:00:01.000Z"),
      end: new Date("2026-08-12T08:00:03.000Z"),
    },
    {
      _id: "canonical",
      original_id: "recording-a",
      runId: "legacy-v0",
      start: new Date("2026-08-12T08:00:01.100Z"),
      end: new Date("2026-08-12T08:00:04.000Z"),
    },
  ]);

  assertEquals(prepared.candidates.map((item) => item._id), ["canonical"]);
  assertEquals(prepared.candidates[0].reviewQuality?.duplicateCount, 1);
  assertEquals(prepared.stats.shortExcluded, 1);
  assertEquals(prepared.stats.duplicateExcluded, 1);
});

Deno.test("a skipped review item can be corrected to a speaker label", () => {
  const revised = applyReviewDecisionRevision([
    {
      segmentId,
      status: "skipped",
      decisionId: "66b000000000000000000099",
    },
  ], {
    segmentIds: [segmentId],
    replacesDecisionId: "66b000000000000000000099",
    decisionId: "66b000000000000000000100",
  });

  assertEquals(revised, [{
    segmentId,
    status: "reviewed",
    decisionId: "66b000000000000000000100",
  }]);
  assert(
    speakerSegmentsRequestSchema.safeParse({
      action: "commit-review-skip",
      sessionId,
      revision: 2,
      clientRequestId: "correct-to-noise",
      segmentIds: [segmentId],
      replacesDecisionId: "66b000000000000000000099",
    }).success,
  );
});

Deno.test("calibration save accepts evidence selection but rejects client metrics", () => {
  const request = {
    action: "save-calibration",
    profileId: skyProfileId,
    calibrationRecordingIds: ["fit-recording"],
    validationRecordingIds: ["check-recording"],
    targetPrecision: 0.98,
  };
  assert(speakerSegmentsRequestSchema.safeParse(request).success);
  assertEquals(
    speakerSegmentsRequestSchema.safeParse({
      ...request,
      calibrationId: "client-chosen",
      metrics: { precision: 1, sky: 40, notSky: 40 },
    }).success,
    false,
  );
});
