import { assertEquals } from "jsr:@std/assert@^1.0.15";
import {
  calibrationEvidenceFingerprint,
  calibrationFingerprintPayload,
  calibrationStaleReasons,
  normalizeCalibrationPolicy,
} from "./calibration-contract.ts";

const context = {
  profileId: "sky",
  profileRevision: 3,
  embeddingSpaceId: "space-v1",
};

function calibration(overrides: Record<string, unknown> = {}) {
  return {
    status: "validated",
    serverComputed: true,
    contractVersion: "server-computed-v1",
    computedBy: "speaker-segments",
    profileId: "sky",
    profileRevision: 3,
    embeddingSpaceId: "space-v1",
    positiveThreshold: 0.8,
    negativeThreshold: 0.3,
    targetPrecision: 0.98,
    validationMetrics: {
      positivePrecision: 0.99,
      negativePrecision: 0.99,
      identified: 20,
      rejected: 20,
      positives: 20,
      negatives: 20,
    },
    calibrationRecordingIds: ["fit"],
    validationRecordingIds: ["check"],
    evidenceSnapshotHash: "evidence-v1",
    ...overrides,
  };
}

Deno.test("legacy strict calibration normalizes to the full policy", () => {
  const value = calibration();
  assertEquals(normalizeCalibrationPolicy(value), {
    classificationPolicy: "full",
    operatorAcceptedLowerPrecision: false,
    maxRangeHours: null,
  });
  assertEquals(calibrationStaleReasons(value, context), []);
});

Deno.test("superseded calibration is not usable even when its metrics still pass", () => {
  const value = calibration({ lifecycleStatus: "superseded" });
  assertEquals(
    calibrationStaleReasons(value, context).includes(
      "superseded by a newer calibration",
    ),
    true,
  );
});

Deno.test("pending calibration is blocked until its profile head is activated", () => {
  const value = calibration({ lifecycleStatus: "pending" });
  assertEquals(
    calibrationStaleReasons(value, context).includes(
      "calibration activation is incomplete",
    ),
    true,
  );
});

Deno.test("independent validation needs meaningful held-out support", () => {
  const value = calibration({
    validationMetrics: {
      positivePrecision: 1,
      identified: 1,
      positives: 1,
      negatives: 20,
    },
  });
  assertEquals(
    calibrationStaleReasons(value, context).includes(
      "independent validation set has insufficient support",
    ),
    true,
  );
});

Deno.test("calibration evidence hash changes when a saved answer changes", async () => {
  const original = await calibrationEvidenceFingerprint([{
    segmentId: "segment-a",
    decisionId: "decision-a",
    label: "positive",
    updatedAt: "2026-08-25T10:00:00.000Z",
  }]);
  const revised = await calibrationEvidenceFingerprint([{
    segmentId: "segment-a",
    decisionId: "decision-b",
    label: "negative",
    updatedAt: "2026-08-25T10:01:00.000Z",
  }]);
  assertEquals(original === revised, false);
});

Deno.test("calibration fingerprint ignores recording order but includes scoring strategy", () => {
  const first = calibrationFingerprintPayload(calibration({
    calibrationRecordingIds: ["b", "a"],
    validationRecordingIds: ["d", "c"],
  }));
  const same = calibrationFingerprintPayload(calibration({
    calibrationRecordingIds: ["a", "b"],
    validationRecordingIds: ["c", "d"],
  }));
  const prototype = calibrationFingerprintPayload(calibration({
    calibrationRecordingIds: ["a", "b"],
    validationRecordingIds: ["c", "d"],
    scoringStrategy: "max_prototype",
  }));
  assertEquals(first, same);
  assertEquals(first === prototype, false);
});

Deno.test("lower precision is usable only as an explicitly accepted bounded pilot", () => {
  const pilot = calibration({
    targetPrecision: 0.95,
    validationMetrics: {
      positivePrecision: 0.96,
      identified: 20,
      positives: 20,
      negatives: 20,
    },
    classificationPolicy: "pilot",
    operatorAcceptedLowerPrecision: true,
    maxRangeHours: 24,
    negativeThreshold: -1,
    negativeDecisionMode: "uncertain_only",
  });
  assertEquals(normalizeCalibrationPolicy(pilot), {
    classificationPolicy: "pilot",
    operatorAcceptedLowerPrecision: true,
    maxRangeHours: 24,
  });
  assertEquals(calibrationStaleReasons(pilot, context), []);

  const unaccepted = {
    ...pilot,
    operatorAcceptedLowerPrecision: false,
  };
  assertEquals(normalizeCalibrationPolicy(unaccepted), null);
  assertEquals(
    calibrationStaleReasons(unaccepted, context).includes(
      "independent validation precision is not proven",
    ),
    true,
  );
});
