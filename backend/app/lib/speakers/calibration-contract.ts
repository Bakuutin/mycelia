export const SPEAKER_CALIBRATION_CONTRACT_VERSION = "server-computed-v1";
export const SPEAKER_CALIBRATION_COMPUTED_BY = "speaker-segments";
export const SPEAKER_CALIBRATION_TARGET_PRECISION = 0.98;
export const SPEAKER_CALIBRATION_PILOT_MIN_PRECISION = 0.9;
export const SPEAKER_CALIBRATION_PILOT_MAX_RANGE_HOURS = 24;
export const SPEAKER_IDENTITY_SNAPSHOT_INDEX =
  "speaker_identity_classification_snapshot";

export type SpeakerCalibrationPolicy = {
  classificationPolicy: "full" | "pilot";
  operatorAcceptedLowerPrecision: boolean;
  maxRangeHours: number | null;
};

export type SpeakerNegativeDecisionMode = "calibrated" | "uncertain_only";

export type SpeakerPositiveThresholdProvenance = {
  recommendedPositiveThreshold: number;
  positiveThresholdSource: "automatic" | "operator_stricter";
};

type ProfileCalibrationContext = {
  profileId: string;
  profileRevision: number;
  embeddingSpaceId?: string | null;
};

function isFiniteThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 &&
    value <= 1;
}

/** Missing mode is the legacy calibrated behavior. */
export function normalizeNegativeDecisionMode(
  calibration: any,
): SpeakerNegativeDecisionMode | null {
  const mode = calibration?.negativeDecisionMode ?? "calibrated";
  if (mode === "calibrated") return mode;
  if (mode === "uncertain_only" && calibration?.negativeThreshold === -1) {
    return mode;
  }
  return null;
}

/** Missing provenance is the legacy automatic-threshold behavior. */
export function normalizePositiveThresholdProvenance(
  calibration: any,
): SpeakerPositiveThresholdProvenance | null {
  const actual = calibration?.positiveThreshold;
  if (!isFiniteThreshold(actual)) return null;
  const recommended = calibration?.recommendedPositiveThreshold ?? actual;
  if (!isFiniteThreshold(recommended)) return null;
  const source = calibration?.positiveThresholdSource ?? "automatic";
  if (source === "automatic" && actual === recommended) {
    return {
      recommendedPositiveThreshold: recommended,
      positiveThresholdSource: source,
    };
  }
  if (
    source === "operator_stricter" &&
    Number(calibration?.targetPrecision ?? 0) <
      SPEAKER_CALIBRATION_TARGET_PRECISION &&
    actual > recommended
  ) {
    return {
      recommendedPositiveThreshold: recommended,
      positiveThresholdSource: source,
    };
  }
  return null;
}

/**
 * Normalize old strict calibrations and validate the explicit lower-precision
 * pilot contract. Existing server-computed v1 records predate policy fields;
 * a >=98% target therefore remains a compatible full calibration.
 */
export function normalizeCalibrationPolicy(
  calibration: any,
): SpeakerCalibrationPolicy | null {
  const targetPrecision = Number(calibration?.targetPrecision ?? 0);
  if (!Number.isFinite(targetPrecision) || targetPrecision > 1) return null;

  if (targetPrecision >= SPEAKER_CALIBRATION_TARGET_PRECISION) {
    if (
      calibration?.classificationPolicy != null &&
      calibration.classificationPolicy !== "full"
    ) return null;
    if (calibration?.maxRangeHours != null) return null;
    if (calibration?.operatorAcceptedLowerPrecision === true) return null;
    return {
      classificationPolicy: "full",
      operatorAcceptedLowerPrecision: false,
      maxRangeHours: null,
    };
  }

  if (
    targetPrecision >= SPEAKER_CALIBRATION_PILOT_MIN_PRECISION &&
    calibration?.classificationPolicy === "pilot" &&
    calibration?.operatorAcceptedLowerPrecision === true &&
    Number(calibration?.maxRangeHours) ===
      SPEAKER_CALIBRATION_PILOT_MAX_RANGE_HOURS
  ) {
    return {
      classificationPolicy: "pilot",
      operatorAcceptedLowerPrecision: true,
      maxRangeHours: SPEAKER_CALIBRATION_PILOT_MAX_RANGE_HOURS,
    };
  }
  return null;
}

export function calibrationStaleReasons(
  calibration: any,
  context: ProfileCalibrationContext,
): string[] {
  const reasons: string[] = [];
  if (calibration?.status !== "validated") {
    reasons.push("not validated");
  }
  if (
    calibration?.serverComputed !== true ||
    calibration?.contractVersion !== SPEAKER_CALIBRATION_CONTRACT_VERSION ||
    calibration?.computedBy !== SPEAKER_CALIBRATION_COMPUTED_BY
  ) {
    reasons.push("not produced by the current server calibration contract");
  }
  if (String(calibration?.profileId ?? "") !== context.profileId) {
    reasons.push("belongs to another profile");
  }
  if (Number(calibration?.profileRevision ?? 0) !== context.profileRevision) {
    reasons.push("profile revision changed");
  }
  if (
    !context.embeddingSpaceId ||
    calibration?.embeddingSpaceId !== context.embeddingSpaceId
  ) {
    reasons.push("embedding space changed");
  }
  const positive = calibration?.positiveThreshold;
  const negative = calibration?.negativeThreshold;
  const negativeDecisionMode = normalizeNegativeDecisionMode(calibration);
  const positiveThresholdProvenance = normalizePositiveThresholdProvenance(
    calibration,
  );
  if (
    !isFiniteThreshold(positive) || !isFiniteThreshold(negative) ||
    negative >= positive || !negativeDecisionMode ||
    !positiveThresholdProvenance
  ) {
    reasons.push("thresholds are missing or invalid");
  }
  const targetPrecision = Number(calibration?.targetPrecision ?? 0);
  const policy = normalizeCalibrationPolicy(calibration);
  const validationPrecision = Number(
    calibration?.validationMetrics?.positivePrecision ?? 0,
  );
  const validationIdentified = Number(
    calibration?.validationMetrics?.identified ?? 0,
  );
  if (
    !policy || validationPrecision < targetPrecision || validationIdentified < 1
  ) {
    reasons.push("independent validation precision is not proven");
  }
  const calibrationIds = Array.isArray(calibration?.calibrationRecordingIds)
    ? calibration.calibrationRecordingIds.map(String)
    : [];
  const validationIds = Array.isArray(calibration?.validationRecordingIds)
    ? calibration.validationRecordingIds.map(String)
    : [];
  const calibrationSet = new Set(calibrationIds);
  if (
    calibrationIds.length === 0 || validationIds.length === 0 ||
    validationIds.some((id: string) => calibrationSet.has(id))
  ) {
    reasons.push("fit/check recording split is missing or overlaps");
  }
  return [...new Set(reasons)];
}

export function findUsableCalibration(
  calibrations: any[],
  context: ProfileCalibrationContext,
): any | null {
  return calibrations.find((calibration) =>
    calibrationStaleReasons(calibration, context).length === 0
  ) ?? null;
}

export function findUsableFullCalibration(
  calibrations: any[],
  context: ProfileCalibrationContext,
): any | null {
  return calibrations.find((calibration) =>
    calibrationStaleReasons(calibration, context).length === 0 &&
    normalizeCalibrationPolicy(calibration)?.classificationPolicy === "full"
  ) ?? null;
}

export function findUsablePilotCalibration(
  calibrations: any[],
  context: ProfileCalibrationContext,
): any | null {
  return calibrations.find((calibration) =>
    calibrationStaleReasons(calibration, context).length === 0 &&
    normalizeCalibrationPolicy(calibration)?.classificationPolicy === "pilot"
  ) ?? null;
}

export function describeCalibrations(
  calibrations: any[],
  context: ProfileCalibrationContext,
): any[] {
  return calibrations.map((calibration) => {
    const staleReasons = calibrationStaleReasons(calibration, context);
    const policy = normalizeCalibrationPolicy(calibration);
    const negativeDecisionMode = normalizeNegativeDecisionMode(calibration);
    const positiveThresholdProvenance = normalizePositiveThresholdProvenance(
      calibration,
    );
    return {
      ...calibration,
      classificationPolicy: policy?.classificationPolicy ??
        calibration?.classificationPolicy ?? null,
      operatorAcceptedLowerPrecision: policy?.operatorAcceptedLowerPrecision ??
        false,
      maxRangeHours: policy?.maxRangeHours ?? calibration?.maxRangeHours ??
        null,
      negativeDecisionMode: negativeDecisionMode ??
        calibration?.negativeDecisionMode ?? null,
      recommendedPositiveThreshold:
        positiveThresholdProvenance?.recommendedPositiveThreshold ??
          calibration?.recommendedPositiveThreshold ?? null,
      positiveThresholdSource:
        positiveThresholdProvenance?.positiveThresholdSource ??
          calibration?.positiveThresholdSource ?? null,
      validity: staleReasons.length === 0 ? "usable" : "stale",
      staleReasons,
    };
  });
}
