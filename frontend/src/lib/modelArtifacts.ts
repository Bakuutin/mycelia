export type ModelArtifactType =
  | "summary"
  | "conversation_extraction"
  | "tagging";

export type ModelArtifactEntry = {
  id: string;
  artifactType: ModelArtifactType;
  objectId: string;
  objectName: string;
  generatedAt?: string | Date;
  requestedModel?: string;
  executedModel?: string;
  fallbackModel?: string;
  fallbackUsed?: boolean;
  providerBaseUrl?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  jobId?: string;
  chunkId?: string;
  provenanceQuality:
    | "exact"
    | "legacy_response_model"
    | "legacy_requested_only";
  parseStatus?: "ok" | "empty" | "parse_error";
  selectedTagCount?: number;
};

export type ModelArtifactResult = {
  entries: ModelArtifactEntry[];
  total: number;
  models: Array<{
    model: string;
    count: number;
    latestAt?: string | Date;
  }>;
  gaps: {
    legacySummariesWithoutExactRouting: number;
    legacyExtractionsWithRequestedAliasOnly: number;
    legacyTagRelationshipsWithoutProvenance: number;
  };
};

export const emptyModelArtifactResult: ModelArtifactResult = {
  entries: [],
  total: 0,
  models: [],
  gaps: {
    legacySummariesWithoutExactRouting: 0,
    legacyExtractionsWithRequestedAliasOnly: 0,
    legacyTagRelationshipsWithoutProvenance: 0,
  },
};

export function normalizeModelArtifactResult(
  value: unknown,
): ModelArtifactResult {
  if (!value || typeof value !== "object") return emptyModelArtifactResult;
  const result = value as Partial<ModelArtifactResult>;
  return {
    entries: Array.isArray(result.entries) ? result.entries : [],
    total: typeof result.total === "number" ? result.total : 0,
    models: Array.isArray(result.models) ? result.models : [],
    gaps: {
      legacySummariesWithoutExactRouting:
        result.gaps?.legacySummariesWithoutExactRouting ?? 0,
      legacyExtractionsWithRequestedAliasOnly:
        result.gaps?.legacyExtractionsWithRequestedAliasOnly ?? 0,
      legacyTagRelationshipsWithoutProvenance:
        result.gaps?.legacyTagRelationshipsWithoutProvenance ?? 0,
    },
  };
}

export function modelArtifactLabel(type: ModelArtifactType): string {
  switch (type) {
    case "summary":
      return "Summary";
    case "conversation_extraction":
      return "Conversation extraction";
    case "tagging":
      return "Tagging";
  }
}
