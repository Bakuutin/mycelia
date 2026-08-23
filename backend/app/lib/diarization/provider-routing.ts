export type DiarizatorReadinessMode = "auto" | "strict" | "legacy";
export type DetectedDiarizatorReadinessMode = "ready" | "legacy-health";

export interface DiarizatorRuntimeProvenance {
  modelId: string;
  modelVersion: string;
  embeddingSpaceId: string;
}

export interface DiarizatorRouteAffinity {
  preferredProviderId?: string;
  compatibleWith?: DiarizatorRuntimeProvenance;
}

export interface ResolvedDiarizatorRoute {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  concurrency: number;
  readinessMode?: DiarizatorReadinessMode;
  source?: string;
  runtimeProvenance?: DiarizatorRuntimeProvenance;
}

export type DiarizatorProviderLoad = Record<string, number>;

export interface DiarizatorRouteHealthConstraint {
  providerProfileId?: string;
  detectedReadinessMode?: DetectedDiarizatorReadinessMode;
  metadata?: Record<string, unknown>;
}

export interface DiarizatorJobRoute {
  providerProfileId: string;
  providerProfileName: string;
  baseUrl: string;
  runtimeProvenance?: DiarizatorRuntimeProvenance;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** Normalize the compact aliases or the full /ready fingerprint payload. */
export function extractDiarizatorRuntimeProvenance(
  value: unknown,
): DiarizatorRuntimeProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const fingerprint = record.diarizationFingerprint;
  const diarization = fingerprint && typeof fingerprint === "object" &&
      !Array.isArray(fingerprint)
    ? fingerprint as Record<string, unknown>
    : undefined;
  const modelId = nonEmptyString(record.modelId) ??
    nonEmptyString(diarization?.model);
  const modelVersion = nonEmptyString(record.modelVersion) ??
    nonEmptyString(diarization?.resolvedRevision);
  const embeddingSpaceId = nonEmptyString(record.embeddingSpaceId);
  if (!modelId || !modelVersion || !embeddingSpaceId) return undefined;
  return { modelId, modelVersion, embeddingSpaceId };
}

export function isSameDiarizatorRuntime(
  left: DiarizatorRuntimeProvenance | undefined,
  right: DiarizatorRuntimeProvenance | undefined,
): boolean {
  return Boolean(
    left && right && left.modelVersion !== "unknown" &&
      right.modelVersion !== "unknown" &&
      left.embeddingSpaceId !== "legacy-unknown" &&
      right.embeddingSpaceId !== "legacy-unknown" &&
      left.modelId === right.modelId &&
      left.modelVersion === right.modelVersion &&
      left.embeddingSpaceId === right.embeddingSpaceId,
  );
}

export function buildDiarizatorJobSnapshot(
  route: DiarizatorJobRoute,
  _existingContext: unknown,
  resolvedAt: string,
) {
  return {
    diarizationServerUrl: route.baseUrl,
    routingContext: {
      providerProfileId: route.providerProfileId,
      providerProfileName: route.providerProfileName,
      sourceId: `diarization:${route.providerProfileId}`,
      resolvedAt,
      ...(route.runtimeProvenance ?? {}),
      ...(route.runtimeProvenance
        ? { runtimeProvenanceSource: "route_readiness" as const }
        : {}),
    },
  };
}

export function selectDiarizatorRoute(
  routes: ResolvedDiarizatorRoute[],
  healthyIds?: Set<string>,
  load: DiarizatorProviderLoad = {},
  requestedProviderId?: string,
  affinity?: DiarizatorRouteAffinity,
): ResolvedDiarizatorRoute | undefined {
  return routes
    .filter((route) =>
      route.enabled && (!healthyIds || healthyIds.has(route.id)) &&
      (!requestedProviderId || route.id === requestedProviderId) &&
      (!affinity?.compatibleWith ||
        isSameDiarizatorRuntime(
          route.runtimeProvenance,
          affinity.compatibleWith,
        )) &&
      (load[route.id] ?? 0) < route.concurrency
    )
    .sort((a, b) => {
      const aPreferred = a.id === affinity?.preferredProviderId ? 0 : 1;
      const bPreferred = b.id === affinity?.preferredProviderId ? 0 : 1;
      const aRatio = (load[a.id] ?? 0) / a.concurrency;
      const bRatio = (load[b.id] ?? 0) / b.concurrency;
      return aPreferred - bPreferred || a.priority - b.priority ||
        aRatio - bRatio ||
        a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    })[0];
}

export function resolveDiarizatorRoutes(
  config: any,
): ResolvedDiarizatorRoute[] {
  const environmentUrl = Deno.env.get("DIARIZATION_SERVER_URL") ??
    "http://host.docker.internal:8085";
  const configured = config?.diarizationProfiles;
  const profiles = ((configured?.profiles ?? []) as any[]).map((profile) => {
    const readinessMode = normalizeDiarizatorReadinessMode(
      profile.readinessMode,
    );
    return {
      id: String(profile.id),
      name: String(profile.name),
      baseUrl: String(profile.baseUrl).replace(/\/+$/, ""),
      enabled: profile.enabled ?? true,
      priority: Number(profile.priority ?? 50),
      // Manual legacy mode intentionally cannot advertise parallel model calls.
      // Auto-detected legacy routes are constrained after the health probe.
      concurrency: readinessMode === "legacy"
        ? 1
        : Number(profile.concurrency ?? 1),
      readinessMode,
      source: "diarization_profile",
    };
  });
  // Keep the deployment-managed route in status snapshots even when it is
  // disabled. Jobs must be able to render its Off toggle so an operator can
  // enable it again without leaving the page.
  profiles.push({
    id: "environment",
    name: "Environment diarizator",
    baseUrl: environmentUrl.replace(/\/+$/, ""),
    enabled: configured?.includeEnvironment ?? true,
    priority: Number(configured?.environmentPriority ?? 50),
    concurrency: normalizeDiarizatorReadinessMode(
        configured?.environmentReadinessMode,
      ) === "legacy"
      ? 1
      : Number(configured?.environmentConcurrency ?? 1),
    readinessMode: normalizeDiarizatorReadinessMode(
      configured?.environmentReadinessMode,
    ),
    source: "environment",
  });
  return profiles;
}

export function normalizeDiarizatorReadinessMode(
  value: unknown,
): DiarizatorReadinessMode {
  return value === "strict" || value === "legacy" ? value : "auto";
}

/** Clamp auto-detected legacy routes to one reserved model call. */
export function applyDiarizatorHealthConstraints(
  routes: ResolvedDiarizatorRoute[],
  healthRoutes: DiarizatorRouteHealthConstraint[] | undefined,
): ResolvedDiarizatorRoute[] {
  const detectedLegacyIds = new Set(
    (healthRoutes ?? [])
      .filter((route) => route.detectedReadinessMode === "legacy-health")
      .map((route) => route.providerProfileId)
      .filter((id): id is string => Boolean(id)),
  );
  const healthById = new Map(
    (healthRoutes ?? []).flatMap((route) =>
      route.providerProfileId ? [[route.providerProfileId, route] as const] : []
    ),
  );
  return routes.map((route) => {
    const runtimeProvenance = extractDiarizatorRuntimeProvenance(
      healthById.get(route.id)?.metadata,
    );
    return {
      ...route,
      ...(detectedLegacyIds.has(route.id) && route.concurrency !== 1
        ? { concurrency: 1 }
        : {}),
      ...(runtimeProvenance ? { runtimeProvenance } : {}),
    };
  });
}
