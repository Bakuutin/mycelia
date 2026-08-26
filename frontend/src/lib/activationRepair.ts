export type EmptyActivationRepairCounts = {
  targetSegments: number;
  targetActiveSegments: number;
  recoverableSupersededSegments: number;
  alreadyActiveReplacementSegments: number;
  competingActiveSegments: number;
  fullySupersededRunDocuments: number;
  partialSupersessionRunDocuments: number;
};

export type EmptyActivationRepairPreview = {
  runId: string;
  range: { start: Date | string; end: Date | string };
  repairable: boolean;
  alreadyRepaired: boolean;
  blockers: string[];
  replacementRunIds: string[];
  activationRevision?: Date | string;
  counts: EmptyActivationRepairCounts;
  summary: string;
  confirmation?: string | null;
  preserves?: string[];
};

export type EmptyActivationRepairList = {
  repairs: EmptyActivationRepairPreview[];
  repairable: number;
};

export type EmptyActivationRepairResult = {
  success: boolean;
  repairId: string;
  runId: string;
  restoredSegments: number;
  replacementRunIds: string[];
  deleted: 0;
};

export function buildEmptyActivationRepairPreviewRequest(runId?: string) {
  return {
    action: "repair-empty-activation-preview" as const,
    ...(runId ? { runId } : {}),
  };
}

export function buildEmptyActivationRepairRequest(
  preview: EmptyActivationRepairPreview,
  confirmation: string,
) {
  return {
    action: "repair-empty-activation" as const,
    runId: preview.runId,
    confirmation,
  };
}
