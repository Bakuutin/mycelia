import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import {
  applyPositiveThresholdOverride,
  chooseCalibrationThresholds,
  evaluateCalibration,
  splitCalibrationRecordings,
} from "./calibration.ts";

Deno.test("calibration thresholds maximize safe automatic coverage", () => {
  const examples = [
    { label: "positive" as const, score: 0.9 },
    { label: "positive" as const, score: 0.8 },
    { label: "negative" as const, score: 0.7 },
    { label: "negative" as const, score: 0.2 },
  ];
  const thresholds = chooseCalibrationThresholds(examples, 0.98);

  assertEquals(thresholds, {
    positiveThreshold: 0.8,
    negativeThreshold: 0.7,
    negativeDecisionMode: "calibrated",
  });
  assertEquals(evaluateCalibration(examples, 0.8, 0.7), {
    total: 4,
    positives: 2,
    negatives: 2,
    identified: 2,
    rejected: 2,
    uncertain: 0,
    truePositive: 2,
    falsePositive: 0,
    trueNegative: 2,
    falseNegative: 0,
    positivePrecision: 1,
    positiveRecall: 1,
    negativePrecision: 1,
    negativeRecall: 1,
  });
});

Deno.test("operator positive override can only make a pilot stricter", () => {
  const recommended = {
    positiveThreshold: 0.274,
    negativeThreshold: -1,
    negativeDecisionMode: "uncertain_only" as const,
  };
  assertEquals(applyPositiveThresholdOverride(recommended, 0.3, true), {
    thresholds: { ...recommended, positiveThreshold: 0.3 },
    recommendedPositiveThreshold: 0.274,
    positiveThresholdSource: "operator_stricter",
  });
  assertThrows(
    () => applyPositiveThresholdOverride(recommended, 0.2, true),
    Error,
    "at least the server recommendation",
  );
  assertThrows(
    () => applyPositiveThresholdOverride(recommended, 0.3, false),
    Error,
    "only for provisional pilots",
  );
});

Deno.test("calibration keeps safe Sky matches when not-Sky cannot be calibrated", () => {
  const examples = [
    { label: "positive" as const, score: 0.9 },
    { label: "positive" as const, score: 0.1 },
    { label: "negative" as const, score: 0.8 },
    { label: "negative" as const, score: 0.2 },
  ];

  const thresholds = chooseCalibrationThresholds(examples, 0.98);
  assertEquals(thresholds, {
    positiveThreshold: 0.9,
    negativeThreshold: -1,
    negativeDecisionMode: "uncertain_only",
  });
  assertEquals(evaluateCalibration(examples, 0.9, -1, "uncertain_only"), {
    total: 4,
    positives: 2,
    negatives: 2,
    identified: 1,
    rejected: 0,
    uncertain: 3,
    truePositive: 1,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    positivePrecision: 1,
    positiveRecall: 0.5,
    negativePrecision: 0,
    negativeRecall: 0,
  });
});

Deno.test("recording split is deterministic and never overlaps", () => {
  const split = splitCalibrationRecordings([
    { id: "large", total: 80 },
    { id: "medium", total: 50 },
    { id: "small", total: 20 },
  ]);

  assertEquals(split, {
    calibrationRecordingIds: ["large"],
    validationRecordingIds: ["medium", "small"],
  });
});
