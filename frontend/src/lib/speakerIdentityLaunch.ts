import type { EmptyActivationRepairPreview } from "./activationRepair";

export type SpeakerIdentityScope =
  | { mode: "all_compatible" }
  | { mode: "range"; start: Date; end: Date };

export type SpeakerIdentityPreflightPartition = {
  runId: string;
  embeddingSpaceId: string;
  start: Date | string;
  end: Date | string;
  eligibleSegments: number;
  generation?: number | null;
};

export type SpeakerIdentityPreflight = {
  canStart: boolean;
  blockers: string[];
  snapshotCutoff: Date | string;
  preflightToken: string;
  totals: {
    eligibleSegments: number;
    alreadyCurrent: number;
    incompatibleSegments: number;
    estimatedBatches: number;
  };
  partitions: SpeakerIdentityPreflightPartition[];
  resolved?: {
    profileId: string;
    profileName?: string | null;
    profileRevision: number;
    embeddingSpaceId?: string | null;
    calibrationId?: string | null;
    classificationPolicy?: "full" | "pilot" | null;
    targetPrecision?: number | null;
    maxRangeHours?: number | null;
  };
  coverageRepair?: EmptyActivationRepairPreview | null;
};

export type SpeakerIdentityCampaignStart = {
  campaignId: string;
  jobId?: string | null;
  status: string;
};

export function buildSpeakerIdentityPreflightRequest(
  profileId: string,
  scope: SpeakerIdentityScope,
) {
  return {
    action: "identity-preflight" as const,
    profileId,
    scope,
  };
}

export function buildSpeakerIdentityCampaignRequest(
  profileId: string,
  preflightToken: string,
) {
  return {
    action: "start-identity-campaign" as const,
    profileId,
    preflightToken,
  };
}

export function shortTechnicalId(value?: string | null): string {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
