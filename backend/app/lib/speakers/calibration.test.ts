import { assertEquals } from "jsr:@std/assert";
import {
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

  assertEquals(thresholds, { positiveThreshold: 0.8, negativeThreshold: 0.7 });
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
