import { describe, expect, it } from "vitest";
import {
  formatToolName,
  getObjectRefFromOutput,
  parseToolOutput,
  summarizeToolCall,
} from "./toolPresentation";

describe("parseToolOutput", () => {
  it("unwraps {type: json, value} envelopes and flattens $oid", () => {
    const output = {
      type: "json",
      value: {
        insertedId: { $oid: "64b000000000000000000001" },
        name: "Dentist",
      },
    };
    expect(parseToolOutput(output)).toEqual({
      insertedId: "64b000000000000000000001",
      name: "Dentist",
    });
  });

  it("passes through non-enveloped values", () => {
    expect(parseToolOutput({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("getObjectRefFromOutput", () => {
  it("extracts the ref from a create result", () => {
    const output = {
      type: "json",
      value: {
        insertedId: { $oid: "64b000000000000000000001" },
        id: "64b000000000000000000001",
        name: "Dentist appointment",
        type: "event",
        url: "/objects/64b000000000000000000001",
      },
    };
    expect(getObjectRefFromOutput(output)).toEqual({
      id: "64b000000000000000000001",
      name: "Dentist appointment",
      type: "event",
      url: "/objects/64b000000000000000000001",
    });
  });

  it("prefers newObjectRef for split results", () => {
    const output = {
      type: "json",
      value: {
        newObjectRef: {
          id: "64b000000000000000000002",
          name: "New thing",
          type: "object",
          url: "/objects/64b000000000000000000002",
        },
      },
    };
    expect(getObjectRefFromOutput(output)?.id).toBe(
      "64b000000000000000000002",
    );
  });

  it("returns null when there is no usable id", () => {
    expect(getObjectRefFromOutput({ type: "json", value: { total: 3 } }))
      .toBeNull();
  });
});

describe("summarizeToolCall", () => {
  it("summarizes a running search", () => {
    expect(summarizeToolCall({
      toolName: "search_searchTranscriptions",
      input: { query: "dentist" },
      state: "input-available",
    })).toBe('Searching transcriptions for "dentist"…');
  });

  it("summarizes a completed create with the result name", () => {
    expect(summarizeToolCall({
      toolName: "objects_create",
      input: { object: { name: "Dentist", isEvent: true } },
      output: {
        type: "json",
        value: { id: "x", name: "Dentist", type: "event" },
      },
      state: "output-available",
    })).toBe('Created event "Dentist"');
  });

  it("summarizes a merge", () => {
    expect(summarizeToolCall({
      toolName: "objects_merge",
      input: { loserIds: ["a", "b"] },
      output: { type: "json", value: { name: "Igor" } },
      state: "output-available",
    })).toBe('Merged 2 objects into "Igor"');
  });

  it("falls back to the formatted tool name", () => {
    expect(summarizeToolCall({
      toolName: "docs_frobnicate",
      state: "output-available",
    })).toBe(formatToolName("docs_frobnicate"));
  });

  it("marks failures", () => {
    expect(summarizeToolCall({
      toolName: "objects_delete",
      state: "output-error",
    })).toContain("failed");
  });
});
