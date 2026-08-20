export type DiarizatorReadinessMode = "auto" | "strict" | "legacy";
export type DetectedDiarizatorReadinessMode = "ready" | "legacy-health";

export interface ResolvedDiarizatorRoute {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  concurrency: number;
  readinessMode?: DiarizatorReadinessMode;
  source?: string;
}

export type DiarizatorProviderLoad = Record<string, number>;

export interface DiarizatorRouteHealthConstraint {
  providerProfileId?: string;
  detectedReadinessMode?: DetectedDiarizatorReadinessMode;
}

export interface DiarizatorJobRoute {
  providerProfileId: string;
  providerProfileName: string;
  baseUrl: string;
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
    },
  };
}

export function selectDiarizatorRoute(
  routes: ResolvedDiarizatorRoute[],
  healthyIds?: Set<string>,
  load: DiarizatorProviderLoad = {},
  requestedProviderId?: string,
): ResolvedDiarizatorRoute | undefined {
  return routes
    .filter((route) =>
      route.enabled && (!healthyIds || healthyIds.has(route.id)) &&
      (!requestedProviderId || route.id === requestedProviderId) &&
      (load[route.id] ?? 0) < route.concurrency
    )
    .sort((a, b) => {
      const aRatio = (load[a.id] ?? 0) / a.concurrency;
      const bRatio = (load[b.id] ?? 0) / b.concurrency;
      return a.priority - b.priority || aRatio - bRatio ||
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
  return routes.map((route) =>
    detectedLegacyIds.has(route.id) && route.concurrency !== 1
      ? { ...route, concurrency: 1 }
      : route
  );
}
