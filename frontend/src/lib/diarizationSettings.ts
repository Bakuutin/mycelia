export type DiarizationReadinessMode = "auto" | "strict" | "legacy";

export type DiarizationProfile = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  concurrency: number;
  readinessMode?: DiarizationReadinessMode;
};

export type DiarizationRouteConfig = {
  profiles: DiarizationProfile[];
  includeEnvironment: boolean;
  environmentPriority: number;
  environmentConcurrency: number;
  environmentReadinessMode?: DiarizationReadinessMode;
};

export const MAX_ENABLED_DIARIZATION_SLOTS = 8;

export type DiarizationBulkEnableResult = {
  config: DiarizationRouteConfig;
  enabledRouteIds: string[];
  skippedRouteIds: string[];
  enabledCapacity: number;
};

export function updateDiarizationRouteConfig(
  config: DiarizationRouteConfig,
  profileId: string,
  changes: {
    enabled?: boolean;
    priority?: number;
    concurrency?: number;
    readinessMode?: DiarizationReadinessMode;
  },
): DiarizationRouteConfig {
  if (
    changes.priority != null &&
    (!Number.isInteger(changes.priority) || changes.priority < 1 ||
      changes.priority > 100)
  ) {
    throw new Error("Diarizator priority must be an integer from 1 to 100.");
  }
  if (
    changes.concurrency != null &&
    (!Number.isInteger(changes.concurrency) || changes.concurrency < 1 ||
      changes.concurrency > 8)
  ) {
    throw new Error("Diarizator slots must be an integer from 1 to 8.");
  }

  const effectiveConcurrency = changes.readinessMode === "legacy"
    ? 1
    : changes.concurrency;
  const next = profileId === "environment"
    ? {
      ...config,
      includeEnvironment: changes.enabled ?? config.includeEnvironment,
      environmentPriority: changes.priority ?? config.environmentPriority,
      environmentConcurrency: effectiveConcurrency ??
        config.environmentConcurrency,
      environmentReadinessMode: changes.readinessMode ??
        config.environmentReadinessMode,
    }
    : {
      ...config,
      profiles: config.profiles.map((profile) =>
        profile.id === profileId
          ? {
            ...profile,
            ...changes,
            ...(effectiveConcurrency != null
              ? { concurrency: effectiveConcurrency }
              : {}),
          }
          : profile
      ),
    };

  if (
    profileId !== "environment" &&
    !config.profiles.some((profile) => profile.id === profileId)
  ) {
    throw new Error("Diarizator route no longer exists.");
  }
  return next;
}

export function validateDiarizationRoutes(
  profiles: DiarizationProfile[],
  includeEnvironment: boolean,
  environmentConcurrency = 1,
): string | null {
  if (
    !Number.isInteger(environmentConcurrency) || environmentConcurrency < 1 ||
    environmentConcurrency > 8
  ) {
    return "Environment diarizator slots must be 1-8.";
  }
  for (const profile of profiles) {
    if (!profile.name.trim()) return "Every server needs a name.";
    try {
      new URL(profile.baseUrl);
    } catch {
      return `${profile.name}: enter a valid http(s) URL.`;
    }
    if (
      !Number.isInteger(profile.priority) || profile.priority < 1 ||
      profile.priority > 100
    ) {
      return `${profile.name}: priority must be 1-100.`;
    }
    if (
      !Number.isInteger(profile.concurrency) || profile.concurrency < 1 ||
      profile.concurrency > 8
    ) {
      return `${profile.name}: slots must be 1-8.`;
    }
    if (
      profile.readinessMode != null &&
      !["auto", "strict", "legacy"].includes(profile.readinessMode)
    ) {
      return `${profile.name}: select a valid readiness mode.`;
    }
  }
  if (
    getEnabledDiarizationCapacity(
      profiles,
      includeEnvironment,
      environmentConcurrency,
    ) > MAX_ENABLED_DIARIZATION_SLOTS
  ) {
    return `Enabled diarization slots cannot exceed ${MAX_ENABLED_DIARIZATION_SLOTS} in total.`;
  }
  return null;
}

export function getEnabledDiarizationCapacity(
  profiles: DiarizationProfile[],
  includeEnvironment: boolean,
  environmentConcurrency = 1,
): number {
  return profiles
    .filter((profile) => profile.enabled)
    .reduce(
      (sum, profile) => sum + (profile.concurrency ?? 1),
      includeEnvironment ? environmentConcurrency : 0,
    );
}

export function setDiarizationRoutesEnabledWithinLimit(
  config: DiarizationRouteConfig,
  routeIds: string[],
  enabled: boolean,
  capacityLimit = MAX_ENABLED_DIARIZATION_SLOTS,
): DiarizationBulkEnableResult {
  const visibleRouteIds = new Set(routeIds);
  const knownRouteCapacity = new Map(
    config.profiles.map((profile) => [profile.id, profile.concurrency ?? 1]),
  );
  knownRouteCapacity.set("environment", config.environmentConcurrency ?? 1);

  if (!enabled) {
    const next = {
      ...config,
      profiles: config.profiles.map((profile) =>
        visibleRouteIds.has(profile.id)
          ? { ...profile, enabled: false }
          : profile
      ),
      includeEnvironment: visibleRouteIds.has("environment")
        ? false
        : config.includeEnvironment,
    };
    return {
      config: next,
      enabledRouteIds: [],
      skippedRouteIds: [],
      enabledCapacity: getEnabledDiarizationCapacity(
        next.profiles,
        next.includeEnvironment,
        next.environmentConcurrency,
      ),
    };
  }

  const fixedCapacity = config.profiles
    .filter((profile) => profile.enabled && !visibleRouteIds.has(profile.id))
    .reduce((sum, profile) => sum + (profile.concurrency ?? 1), 0) +
    (config.includeEnvironment && !visibleRouteIds.has("environment")
      ? config.environmentConcurrency ?? 1
      : 0);
  let usedCapacity = fixedCapacity;
  const enabledRouteIds: string[] = [];
  const skippedRouteIds: string[] = [];

  for (const routeId of routeIds) {
    const routeCapacity = knownRouteCapacity.get(routeId);
    if (routeCapacity == null) continue;
    if (usedCapacity + routeCapacity <= capacityLimit) {
      enabledRouteIds.push(routeId);
      usedCapacity += routeCapacity;
    } else {
      skippedRouteIds.push(routeId);
    }
  }

  const selectedRouteIds = new Set(enabledRouteIds);
  const next = {
    ...config,
    profiles: config.profiles.map((profile) =>
      visibleRouteIds.has(profile.id)
        ? { ...profile, enabled: selectedRouteIds.has(profile.id) }
        : profile
    ),
    includeEnvironment: visibleRouteIds.has("environment")
      ? selectedRouteIds.has("environment")
      : config.includeEnvironment,
  };

  return {
    config: next,
    enabledRouteIds,
    skippedRouteIds,
    enabledCapacity: getEnabledDiarizationCapacity(
      next.profiles,
      next.includeEnvironment,
      next.environmentConcurrency,
    ),
  };
}
