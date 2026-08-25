export type CalibrationExample = {
  label: "positive" | "negative";
  score: number;
};

export type CalibrationMetrics = {
  total: number;
  positives: number;
  negatives: number;
  identified: number;
  rejected: number;
  uncertain: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  positivePrecision: number;
  positiveRecall: number;
  negativePrecision: number;
  negativeRecall: number;
};

export type NegativeDecisionMode = "calibrated" | "uncertain_only";

export type CalibrationThresholds = {
  positiveThreshold: number;
  negativeThreshold: number;
  negativeDecisionMode: NegativeDecisionMode;
};

export type CalibrationDecision = "identified" | "rejected" | "uncertain";

export function classifyCalibrationScore(
  score: number,
  positiveThreshold: number,
  negativeThreshold: number,
  negativeDecisionMode: NegativeDecisionMode = "calibrated",
): CalibrationDecision {
  if (score >= positiveThreshold) return "identified";
  if (
    negativeDecisionMode === "calibrated" && score <= negativeThreshold
  ) return "rejected";
  return "uncertain";
}

export type PositiveThresholdSelection = {
  thresholds: CalibrationThresholds | null;
  recommendedPositiveThreshold: number | null;
  positiveThresholdSource: "automatic" | "operator_stricter";
};

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    aa += a[index] * a[index];
    bb += b[index] * b[index];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}

export function evaluateCalibration(
  examples: CalibrationExample[],
  positiveThreshold: number,
  negativeThreshold: number,
  negativeDecisionMode: NegativeDecisionMode = "calibrated",
): CalibrationMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let uncertain = 0;
  for (const example of examples) {
    const decision = classifyCalibrationScore(
      example.score,
      positiveThreshold,
      negativeThreshold,
      negativeDecisionMode,
    );
    if (decision === "identified") {
      if (example.label === "positive") truePositive += 1;
      else falsePositive += 1;
    } else if (decision === "rejected") {
      if (example.label === "negative") trueNegative += 1;
      else falseNegative += 1;
    } else {
      uncertain += 1;
    }
  }
  const positives = examples.filter((item) => item.label === "positive").length;
  const negatives = examples.length - positives;
  return {
    total: examples.length,
    positives,
    negatives,
    identified: truePositive + falsePositive,
    rejected: trueNegative + falseNegative,
    uncertain,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    positivePrecision: ratio(truePositive, truePositive + falsePositive),
    positiveRecall: ratio(truePositive, positives),
    negativePrecision: ratio(trueNegative, trueNegative + falseNegative),
    negativeRecall: ratio(trueNegative, negatives),
  };
}

export function chooseCalibrationThresholds(
  examples: CalibrationExample[],
  targetPrecision = 0.98,
): CalibrationThresholds | null {
  if (
    !examples.some((item) => item.label === "positive") ||
    !examples.some((item) => item.label === "negative")
  ) return null;
  const candidates = [...new Set(examples.map((item) => item.score))].sort((
    a,
    b,
  ) => a - b);
  const positive = candidates.map((threshold) => ({
    threshold,
    metrics: evaluateCalibration(examples, threshold, -1),
  })).filter((item) =>
    item.metrics.identified > 0 &&
    item.metrics.positivePrecision >= targetPrecision
  ).sort((a, b) =>
    b.metrics.positiveRecall - a.metrics.positiveRecall ||
    a.threshold - b.threshold
  )[0];
  if (!positive) return null;
  const negative =
    candidates.filter((threshold) => threshold < positive.threshold)
      .map((threshold) => ({
        threshold,
        metrics: evaluateCalibration(examples, positive.threshold, threshold),
      })).filter((item) =>
        item.metrics.rejected > 0 &&
        item.metrics.negativePrecision >= targetPrecision
      ).sort((a, b) =>
        b.metrics.negativeRecall - a.metrics.negativeRecall ||
        b.threshold - a.threshold
      )[0];
  if (!negative) {
    return {
      positiveThreshold: positive.threshold,
      negativeThreshold: -1,
      negativeDecisionMode: "uncertain_only",
    };
  }
  return {
    positiveThreshold: positive.threshold,
    negativeThreshold: negative.threshold,
    negativeDecisionMode: "calibrated",
  };
}

export function applyPositiveThresholdOverride(
  recommended: CalibrationThresholds | null,
  positiveThresholdOverride: number | undefined,
  allowOperatorOverride: boolean,
): PositiveThresholdSelection {
  const recommendedPositiveThreshold = recommended?.positiveThreshold ?? null;
  if (positiveThresholdOverride === undefined) {
    return {
      thresholds: recommended,
      recommendedPositiveThreshold,
      positiveThresholdSource: "automatic",
    };
  }
  if (!allowOperatorOverride) {
    throw new Error(
      "Positive threshold override is available only for provisional pilots",
    );
  }
  if (
    !Number.isFinite(positiveThresholdOverride) ||
    positiveThresholdOverride < -1 || positiveThresholdOverride > 1
  ) {
    throw new Error("Positive threshold override must be between -1 and 1");
  }
  if (!recommended || recommendedPositiveThreshold === null) {
    throw new Error(
      "A server-recommended positive threshold is required before overriding it",
    );
  }
  if (positiveThresholdOverride < recommendedPositiveThreshold) {
    throw new Error(
      `Positive threshold override must be at least the server recommendation (${recommendedPositiveThreshold})`,
    );
  }
  if (positiveThresholdOverride === recommendedPositiveThreshold) {
    return {
      thresholds: recommended,
      recommendedPositiveThreshold,
      positiveThresholdSource: "automatic",
    };
  }
  return {
    thresholds: {
      ...recommended,
      positiveThreshold: positiveThresholdOverride,
    },
    recommendedPositiveThreshold,
    positiveThresholdSource: "operator_stricter",
  };
}

export function splitCalibrationRecordings(
  recordings: Array<{ id: string; total: number }>,
): { calibrationRecordingIds: string[]; validationRecordingIds: string[] } {
  const sorted = [...recordings].sort((a, b) =>
    b.total - a.total || a.id.localeCompare(b.id)
  );
  const calibrationRecordingIds: string[] = [];
  const validationRecordingIds: string[] = [];
  let calibrationTotal = 0;
  let validationTotal = 0;
  for (const recording of sorted) {
    if (
      calibrationRecordingIds.length === 0 ||
      (validationRecordingIds.length > 0 && calibrationTotal <= validationTotal)
    ) {
      calibrationRecordingIds.push(recording.id);
      calibrationTotal += recording.total;
    } else {
      validationRecordingIds.push(recording.id);
      validationTotal += recording.total;
    }
  }
  return { calibrationRecordingIds, validationRecordingIds };
}
