// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getDiarizatorReadinessBadge } from "./diarizationReadiness";

describe("getDiarizatorReadinessBadge", () => {
  it("distinguishes current and auto-detected legacy services", () => {
    expect(getDiarizatorReadinessBadge({
      status: "healthy",
      readinessMode: "auto",
      detectedReadinessMode: "ready",
    })).toMatchObject({ kind: "current", label: "Current · /ready" });

    expect(getDiarizatorReadinessBadge({
      status: "healthy",
      readinessMode: "auto",
      detectedReadinessMode: "legacy-health",
    })).toMatchObject({ kind: "legacy", label: "Legacy · auto" });
  });

  it("keeps manual legacy and rejected fallback states explicit", () => {
    expect(getDiarizatorReadinessBadge({
      status: "unavailable",
      readinessMode: "legacy",
      detectedReadinessMode: "legacy-health",
    })).toMatchObject({ kind: "legacy", label: "Legacy · manual" });

    expect(getDiarizatorReadinessBadge({
      status: "unavailable",
      readinessMode: "auto",
      detectedReadinessMode: "legacy-health",
    })).toMatchObject({
      kind: "unresolved",
      label: "Legacy · unverified",
    });
  });

  it("shows routes whose compatibility has not been resolved yet", () => {
    expect(getDiarizatorReadinessBadge({
      status: "disabled",
      readinessMode: "auto",
    })).toMatchObject({ kind: "unresolved", label: "Auto · unresolved" });

    expect(getDiarizatorReadinessBadge({
      status: "unavailable",
      readinessMode: "strict",
    })).toMatchObject({ kind: "unresolved", label: "Strict /ready" });
  });
});
