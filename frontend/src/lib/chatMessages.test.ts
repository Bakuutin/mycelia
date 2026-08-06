import { describe, expect, it } from "vitest";
import { dbMessageToUIMessage, legacyContentToParts } from "./chatMessages";

describe("legacyContentToParts", () => {
  it("converts a plain string into a text part", () => {
    expect(legacyContentToParts("hello")).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  it("pairs tool-call and tool-result parts by toolCallId", () => {
    const parts = legacyContentToParts([
      { type: "text", text: "Searching…" },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "search_searchObjects",
        input: { query: "dentist" },
      },
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "search_searchObjects",
        output: { type: "json", value: [] },
      },
    ]);

    expect(parts).toEqual([
      { type: "text", text: "Searching…" },
      {
        type: "tool-search_searchObjects",
        toolCallId: "call_1",
        state: "output-available",
        input: { query: "dentist" },
        output: { type: "json", value: [] },
      },
    ]);
  });

  it("marks tool-error parts as output-error with errorText", () => {
    const parts = legacyContentToParts([
      {
        type: "tool-call",
        toolCallId: "call_2",
        toolName: "objects_get",
        input: { id: "x" },
      },
      {
        type: "tool-error",
        toolCallId: "call_2",
        error: { message: "Object not found" },
      },
    ]) as any[];

    expect(parts[0].state).toBe("output-error");
    expect(parts[0].errorText).toBe("Object not found");
  });

  it("drops step-start markers and orphaned tool-results", () => {
    const parts = legacyContentToParts([
      { type: "step-start" },
      { type: "tool-result", toolCallId: "orphan", output: {} },
    ]);
    expect(parts).toEqual([]);
  });
});

describe("dbMessageToUIMessage", () => {
  it("uses raw.uiMessage verbatim for new-format documents", () => {
    const msg = {
      _id: { toString: () => "aaaaaaaaaaaaaaaaaaaaaaaa" },
      createdAt: "2026-08-01T00:00:00Z",
      raw: {
        role: "assistant",
        model: "gpt-x",
        uiMessage: {
          id: "stream-id",
          role: "assistant",
          parts: [{ type: "text", text: "done" }],
        },
      },
    };

    const ui = dbMessageToUIMessage(msg);
    expect(ui.id).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(ui.parts).toEqual([{ type: "text", text: "done" }]);
    expect((ui.metadata as any).model).toBe("gpt-x");
  });

  it("converts legacy documents into UIMessages", () => {
    const msg = {
      _id: { toString: () => "bbbbbbbbbbbbbbbbbbbbbbbb" },
      createdAt: "2026-08-01T00:00:00Z",
      raw: { role: "user", content: "hi there" },
    };

    const ui = dbMessageToUIMessage(msg);
    expect(ui.role).toBe("user");
    expect(ui.parts).toEqual([{ type: "text", text: "hi there" }]);
  });
});
