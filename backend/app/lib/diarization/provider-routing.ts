export interface ResolvedDiarizatorRoute {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  concurrency: number;
  source?: string;
}

export type DiarizatorProviderLoad = Record<string, number>;

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
  const profiles = ((configured?.profiles ?? []) as any[]).map((profile) => ({
    id: String(profile.id),
    name: String(profile.name),
    baseUrl: String(profile.baseUrl).replace(/\/+$/, ""),
    enabled: profile.enabled ?? true,
    priority: Number(profile.priority ?? 50),
    concurrency: Number(profile.concurrency ?? 1),
    source: "diarization_profile",
  }));
  if (configured?.includeEnvironment ?? true) {
    profiles.push({
      id: "environment",
      name: "Environment diarizator",
      baseUrl: environmentUrl.replace(/\/+$/, ""),
      enabled: true,
      priority: Number(configured?.environmentPriority ?? 50),
      concurrency: Number(configured?.environmentConcurrency ?? 1),
      source: "environment",
    });
  }
  return profiles;
}
