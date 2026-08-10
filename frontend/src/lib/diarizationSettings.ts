export type DiarizationProfile = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
};

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
