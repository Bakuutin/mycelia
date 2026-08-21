import { assertEquals } from "jsr:@std/assert@^1.0.15";
import {
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
    validationMetrics: { positivePrecision: 0.99, identified: 10 },
    calibrationRecordingIds: ["fit"],
    validationRecordingIds: ["check"],
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

Deno.test("lower precision is usable only as an explicitly accepted bounded pilot", () => {
  const pilot = calibration({
    targetPrecision: 0.95,
    validationMetrics: { positivePrecision: 0.96, identified: 10 },
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
