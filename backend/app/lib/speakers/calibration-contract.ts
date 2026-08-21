export const SPEAKER_CALIBRATION_CONTRACT_VERSION = "server-computed-v1";
export const SPEAKER_CALIBRATION_COMPUTED_BY = "speaker-segments";
export const SPEAKER_CALIBRATION_TARGET_PRECISION = 0.98;
export const SPEAKER_IDENTITY_SNAPSHOT_INDEX =
  "speaker_identity_classification_snapshot";

type ProfileCalibrationContext = {
  profileId: string;
  profileRevision: number;
  embeddingSpaceId?: string | null;
};

function isFiniteThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 &&
    value <= 1;
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
  if (
    !isFiniteThreshold(positive) || !isFiniteThreshold(negative) ||
    negative >= positive
  ) {
    reasons.push("thresholds are missing or invalid");
  }
  const targetPrecision = Number(calibration?.targetPrecision ?? 0);
  const validationPrecision = Number(
    calibration?.validationMetrics?.positivePrecision ?? 0,
  );
  const validationIdentified = Number(
    calibration?.validationMetrics?.identified ?? 0,
  );
  if (
    targetPrecision < SPEAKER_CALIBRATION_TARGET_PRECISION ||
    validationPrecision < targetPrecision || validationIdentified < 1
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

export function describeCalibrations(
  calibrations: any[],
  context: ProfileCalibrationContext,
): any[] {
  return calibrations.map((calibration) => {
    const staleReasons = calibrationStaleReasons(calibration, context);
    return {
      ...calibration,
      validity: staleReasons.length === 0 ? "usable" : "stale",
      staleReasons,
    };
  });
}
