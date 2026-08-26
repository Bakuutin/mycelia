export const SPEAKER_CALIBRATION_CONTRACT_VERSION = "server-computed-v1";
export const SPEAKER_CALIBRATION_COMPUTED_BY = "speaker-segments";
export const SPEAKER_CALIBRATION_TARGET_PRECISION = 0.98;
export const SPEAKER_CALIBRATION_PILOT_MIN_PRECISION = 0.9;
export const SPEAKER_CALIBRATION_PILOT_MAX_RANGE_HOURS = 24;
export const SPEAKER_CALIBRATION_MIN_CHECK_PER_CLASS = 20;
export const SPEAKER_CALIBRATION_MIN_CHECK_AUTO_MATCHES = 20;
export const SPEAKER_CALIBRATION_MIN_CHECK_AUTO_REJECTIONS = 20;
export const SPEAKER_IDENTITY_SNAPSHOT_INDEX =
  "speaker_identity_classification_snapshot";

function sortedStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).sort() : [];
}

export function calibrationFingerprintPayload(calibration: any): string {
  return JSON.stringify({
    profileId: String(calibration?.profileId ?? ""),
    profileRevision: Number(calibration?.profileRevision ?? 0),
    embeddingSpaceId: String(calibration?.embeddingSpaceId ?? ""),
    calibrationRecordingIds: sortedStrings(
      calibration?.calibrationRecordingIds,
    ),
    validationRecordingIds: sortedStrings(calibration?.validationRecordingIds),
    targetPrecision: Number(calibration?.targetPrecision ?? 0),
    positiveThreshold: Number(calibration?.positiveThreshold ?? 0),
    recommendedPositiveThreshold: Number(
      calibration?.recommendedPositiveThreshold ??
        calibration?.positiveThreshold ?? 0,
    ),
    positiveThresholdSource: calibration?.positiveThresholdSource ??
      "automatic",
    negativeThreshold: Number(calibration?.negativeThreshold ?? 0),
    negativeDecisionMode: calibration?.negativeDecisionMode ?? "calibrated",
    classificationPolicy: calibration?.classificationPolicy ??
      (Number(calibration?.targetPrecision ?? 0) >=
          SPEAKER_CALIBRATION_TARGET_PRECISION
        ? "full"
        : "pilot"),
    scoringStrategy: calibration?.scoringStrategy ?? "centroid",
    calibrationAlgorithmVersion: calibration?.calibrationAlgorithmVersion ??
      "cosine-thresholds-v2",
    evidenceSnapshotHash: String(calibration?.evidenceSnapshotHash ?? ""),
  });
}

export async function calibrationEvidenceFingerprint(
  evidence: Array<Record<string, unknown>>,
): Promise<string> {
  const canonical = [...evidence].sort((left, right) =>
    String(left.segmentId).localeCompare(String(right.segmentId))
  );
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export async function calibrationFingerprint(
  calibration: any,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    calibrationFingerprintPayload(calibration),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

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
    calibration?.lifecycleStatus != null &&
    calibration.lifecycleStatus !== "active"
  ) {
    reasons.push(
      calibration.lifecycleStatus === "superseded"
        ? "superseded by a newer calibration"
        : "calibration activation is incomplete",
    );
  }
  if (!calibration?.evidenceSnapshotHash) {
    reasons.push("calibration evidence snapshot is missing");
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
  if (!policy || validationPrecision < targetPrecision) {
    reasons.push("independent validation precision is not proven");
  }
  if (
    validationIdentified < SPEAKER_CALIBRATION_MIN_CHECK_AUTO_MATCHES ||
    Number(calibration?.validationMetrics?.positives ?? 0) <
      SPEAKER_CALIBRATION_MIN_CHECK_PER_CLASS ||
    Number(calibration?.validationMetrics?.negatives ?? 0) <
      SPEAKER_CALIBRATION_MIN_CHECK_PER_CLASS
  ) {
    reasons.push("independent validation set has insufficient support");
  }
  if (
    normalizeNegativeDecisionMode(calibration) === "calibrated" &&
    (Number(calibration.validationMetrics?.rejected ?? 0) <
        SPEAKER_CALIBRATION_MIN_CHECK_AUTO_REJECTIONS ||
      Number(calibration.validationMetrics?.negativePrecision ?? 0) <
        Number(calibration.targetPrecision ?? 1))
  ) {
    reasons.push(
      "automatic not-target decisions are not proven on independent validation",
    );
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
