import { expect } from "@std/expect";
import { sanitizeUIMessages } from "./api.chat.ts";

Deno.test("sanitizeUIMessages omits persisted empty assistant failures", () => {
  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "retry" }],
    },
    {
      id: "assistant-empty",
      role: "assistant",
      parts: [],
      metadata: { error: { type: "empty_response" } },
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "retry again" }],
    },
  ];

  expect(sanitizeUIMessages(messages)).toEqual([messages[0], messages[2]]);
});

Deno.test("sanitizeUIMessages strips null part fields without dropping content", () => {
  expect(sanitizeUIMessages([{
    id: "assistant-1",
    role: "assistant",
    parts: [{
      type: "text",
      text: "ok",
      providerMetadata: null,
    }],
  }])).toEqual([{
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "ok" }],
  }]);
});
