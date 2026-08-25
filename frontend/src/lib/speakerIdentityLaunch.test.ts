import { describe, expect, it } from "vitest";
import {
  buildSpeakerIdentityCampaignRequest,
  buildSpeakerIdentityPreflightRequest,
  shortTechnicalId,
} from "./speakerIdentityLaunch";

describe("speaker identity campaign contract", () => {
  it("keeps automatic resolution on the server for full-history campaigns", () => {
    const scope = { mode: "all_compatible" as const };

    expect(buildSpeakerIdentityPreflightRequest("sky-id", scope)).toEqual({
      action: "identity-preflight",
      profileId: "sky-id",
      scope,
    });
    expect(
      buildSpeakerIdentityCampaignRequest("sky-id", "snapshot-1"),
    ).toEqual({
      action: "start-identity-campaign",
      profileId: "sky-id",
      preflightToken: "snapshot-1",
    });
  });

  it("supports an advanced bounded range without exposing run selection", () => {
    const scope = {
      mode: "range" as const,
      start: new Date("2026-08-20T12:00:00.000Z"),
      end: new Date("2026-08-21T12:00:00.000Z"),
    };

    expect(buildSpeakerIdentityPreflightRequest("sky-id", scope)).toEqual({
      action: "identity-preflight",
      profileId: "sky-id",
      scope,
    });
  });

  it("shortens technical identifiers for advanced diagnostics", () => {
    expect(shortTechnicalId("diarization-run-1234567890")).toBe(
      "diarizat…7890",
    );
    expect(shortTechnicalId("legacy-v0")).toBe("legacy-v0");
  });
});
