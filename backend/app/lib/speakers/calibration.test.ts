import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.15";
import {
  applyHeldOutNegativeSafety,
  applyPositiveThresholdOverride,
  chooseCalibrationThresholds,
  classifyCalibrationScore,
  evaluateCalibration,
  isolateEnrollmentSourceRecordings,
  selectProfileScoringStrategy,
  splitCalibrationRecordings,
} from "./calibration.ts";

Deno.test("calibration exposes the exact decision behind validation errors", () => {
  assertEquals(classifyCalibrationScore(0.81, 0.8, 0.4), "identified");
  assertEquals(classifyCalibrationScore(0.2, 0.8, 0.4), "rejected");
  assertEquals(
    classifyCalibrationScore(0.2, 0.8, -1, "uncertain_only"),
    "uncertain",
  );
});

Deno.test("profile scoring strategy is selected on Learn for maximum safe recall", () => {
  const selected = selectProfileScoringStrategy(
    [
      { label: "positive", embedding: [1, 0], value: "mic-a" },
      { label: "positive", embedding: [-1, 0], value: "mic-b" },
      { label: "positive", embedding: [0, 1], value: "mic-c" },
      { label: "negative", embedding: [1, 1], value: "other" },
    ],
    [0, 1],
    [[1, 0], [-1, 0], [0, 1]],
    0.98,
  );
  assertEquals(selected?.strategy, "max_prototype");
  assertEquals(selected?.metrics.positiveRecall, 1);
});

Deno.test("calibration excludes Timeline enrollment recordings and fails closed on unknown Timeline provenance", () => {
  const isolated = isolateEnrollmentSourceRecordings(
    [
      { recordingId: "enrollment-recording", label: "positive" },
      { recordingId: "independent-recording", label: "negative" },
    ],
    [
      {
        embedding: [1, 0],
        provenance: {
          source: "review_selection",
          originalId: "enrollment-recording",
          interval: {
            start: "2026-08-10T10:00:00.000Z",
            end: "2026-08-10T10:00:12.000Z",
          },
        },
      },
      { embedding: [0, 1], source: "timeline_selection" },
      { embedding: [0.5, 0.5], source: "microphone" },
    ],
  );

  assertEquals(isolated.examples, [
    { recordingId: "independent-recording", label: "negative" },
  ]);
  assertEquals(isolated.enrollmentRecordingIds, ["enrollment-recording"]);
  assertEquals(isolated.excludedRecordingIds, ["enrollment-recording"]);
  assertEquals(isolated.excludedExampleCount, 1);
  assertEquals(isolated.unknownTimelinePrototypeCount, 1);
});

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

Deno.test("held-out Check disables automatic not-Sky when rejection precision is unproven", () => {
  const thresholds = applyHeldOutNegativeSafety(
    {
      positiveThreshold: 0.8,
      negativeThreshold: 0.3,
      negativeDecisionMode: "calibrated",
    },
    {
      total: 40,
      positives: 20,
      negatives: 20,
      identified: 20,
      rejected: 20,
      uncertain: 0,
      truePositive: 20,
      falsePositive: 0,
      trueNegative: 10,
      falseNegative: 10,
      positivePrecision: 1,
      positiveRecall: 1,
      negativePrecision: 0.5,
      negativeRecall: 0.5,
    },
    0.98,
    20,
  );
  assertEquals(thresholds, {
    positiveThreshold: 0.8,
    negativeThreshold: -1,
    negativeDecisionMode: "uncertain_only",
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
