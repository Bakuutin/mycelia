import { describe, expect, it } from "vitest";
import {
  emptyModelArtifactResult,
  modelArtifactLabel,
  normalizeModelArtifactResult,
} from "./modelArtifacts";

describe("model artifact history", () => {
  it("normalizes absent resource fields", () => {
    expect(normalizeModelArtifactResult(null)).toEqual(
      emptyModelArtifactResult,
    );
  });

  it("uses human labels for every persisted artifact type", () => {
    expect(modelArtifactLabel("summary")).toBe("Summary");
    expect(modelArtifactLabel("conversation_extraction")).toBe(
      "Conversation extraction",
    );
    expect(modelArtifactLabel("tagging")).toBe("Tagging");
  });
});
