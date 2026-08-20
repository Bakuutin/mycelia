export type DiarizatorReadinessMode = "auto" | "strict" | "legacy";
export type DetectedDiarizatorReadinessMode = "ready" | "legacy-health";

export type DiarizatorReadinessBadge = {
  kind: "current" | "legacy" | "unresolved";
  label: string;
  title: string;
};

export function getDiarizatorReadinessBadge(route: {
  status: string;
  readinessMode?: DiarizatorReadinessMode;
  detectedReadinessMode?: DetectedDiarizatorReadinessMode;
}): DiarizatorReadinessBadge {
  const configuredMode = route.readinessMode ?? "auto";

  if (configuredMode === "legacy") {
    return {
      kind: "legacy",
      label: "Legacy · manual",
      title:
        "The route is explicitly configured to use /health; inference readiness is operator-controlled.",
    };
  }

  if (route.detectedReadinessMode === "legacy-health") {
    return route.status === "healthy"
      ? {
        kind: "legacy",
        label: "Legacy · auto",
        title:
          "The /ready endpoint was absent and the legacy /health response proved model readiness.",
      }
      : {
        kind: "unresolved",
        label: "Legacy · unverified",
        title:
          "The /ready endpoint was absent, but the /health response did not prove inference readiness.",
      };
  }

  if (
    route.detectedReadinessMode === "ready" && route.status === "healthy"
  ) {
    return {
      kind: "current",
      label: "Current · /ready",
      title: "The current inference-aware /ready contract is healthy.",
    };
  }

  if (configuredMode === "strict") {
    return {
      kind: "unresolved",
      label: "Strict /ready",
      title: "Only the current /ready contract is allowed for this route.",
    };
  }

  return {
    kind: "unresolved",
    label: "Auto · unresolved",
    title: "Auto detection has not established a healthy readiness contract.",
  };
}
