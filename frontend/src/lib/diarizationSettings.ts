export type DiarizationProfile = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
};

export type DiarizationRouteConfig = {
  profiles: DiarizationProfile[];
  includeEnvironment: boolean;
  environmentPriority: number;
};

export function updateDiarizationRouteConfig(
  config: DiarizationRouteConfig,
  profileId: string,
  changes: { enabled?: boolean; priority?: number },
): DiarizationRouteConfig {
  if (
    changes.priority != null &&
    (!Number.isInteger(changes.priority) || changes.priority < 1 ||
      changes.priority > 100)
  ) {
    throw new Error("Diarizator priority must be an integer from 1 to 100.");
  }

  const next = profileId === "environment"
    ? {
      ...config,
      includeEnvironment: changes.enabled ?? config.includeEnvironment,
      environmentPriority: changes.priority ?? config.environmentPriority,
    }
    : {
      ...config,
      profiles: config.profiles.map((profile) =>
        profile.id === profileId ? { ...profile, ...changes } : profile
      ),
    };

  if (
    profileId !== "environment" &&
    !config.profiles.some((profile) => profile.id === profileId)
  ) {
    throw new Error("Diarizator route no longer exists.");
  }
  if (
    !next.includeEnvironment &&
    !next.profiles.some((profile) => profile.enabled)
  ) {
    throw new Error("Keep at least one diarizator route enabled.");
  }
  return next;
}

export function validateDiarizationRoutes(
  profiles: DiarizationProfile[],
  includeEnvironment: boolean,
): string | null {
  if (!includeEnvironment && !profiles.some((profile) => profile.enabled)) {
    return "Enable at least one diarizator server or the environment route.";
  }
  for (const profile of profiles) {
    if (!profile.name.trim()) return "Every server needs a name.";
    try {
      new URL(profile.baseUrl);
    } catch {
      return `${profile.name}: enter a valid http(s) URL.`;
    }
    if (!Number.isInteger(profile.priority) || profile.priority < 1 || profile.priority > 100) {
      return `${profile.name}: priority must be 1-100.`;
    }
  }
  return null;
}
