import { describe, expect, it } from "vitest";
import { extractModelIds, getModelsEndpoint } from "./inferenceModels";

describe("getModelsEndpoint", () => {
  it("adds the OpenAI-compatible models path", () => {
    expect(getModelsEndpoint("https://api.example.com"))
      .toBe("https://api.example.com/v1/models");
  });

  it("does not duplicate an existing v1 path", () => {
    expect(getModelsEndpoint("https://api.example.com/v1/"))
      .toBe("https://api.example.com/v1/models");
  });
});

describe("extractModelIds", () => {
  it("returns sorted, unique model names and ignores invalid entries", () => {
    expect(extractModelIds([
      { id: "z-model" },
      { id: "a-model" },
      { id: "z-model" },
      { name: "missing-id" },
      "direct-model",
      null,
    ])).toEqual(["a-model", "direct-model", "z-model"]);
  });
});
