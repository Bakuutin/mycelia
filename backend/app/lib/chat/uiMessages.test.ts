import { tool } from "ai";
import { expect } from "@std/expect";
import { z } from "zod";
import {
  convertIncomingChatMessagesToModelMessages,
  legacyContentToUIParts,
} from "./uiMessages.ts";

const objectsCreateTool = tool({
  inputSchema: z.object({
    name: z.string(),
  }),
});

Deno.test("legacyContentToUIParts converts legacy tool content into UI tool parts", () => {
  const parts = legacyContentToUIParts([
    { type: "text", text: "Created it." },
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "objects_create",
      input: { name: "Alpha" },
    },
    {
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "objects_create",
      output: { type: "json", value: { insertedId: "507f1f77bcf86cd799439099" } },
    },
  ]);

  expect(parts).toEqual([
    { type: "text", text: "Created it." },
    {
      type: "tool-objects_create",
      toolCallId: "call-1",
      input: { name: "Alpha" },
      output: { insertedId: "507f1f77bcf86cd799439099" },
      providerExecuted: undefined,
      state: "output-available",
    },
  ]);
});

Deno.test("convertIncomingChatMessagesToModelMessages preserves approval responses", async () => {
  const { modelMessages } = await convertIncomingChatMessagesToModelMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Create Alpha" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "tool-objects_create",
          toolCallId: "call-1",
          state: "approval-responded",
          input: { name: "Alpha" },
          approval: {
            id: "approval-1",
            approved: true,
          },
        }],
      },
    ],
    {
      objects_create: objectsCreateTool,
    },
  );

  expect(modelMessages[0]).toEqual({
    role: "user",
    content: [{ type: "text", text: "Create Alpha" }],
  });
  expect(modelMessages[1]).toEqual({
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "objects_create",
        input: { name: "Alpha" },
        providerExecuted: undefined,
      },
      {
        type: "tool-approval-request",
        approvalId: "approval-1",
        toolCallId: "call-1",
      },
    ],
  });
  expect(modelMessages[2]).toEqual({
    role: "tool",
    content: [{
      type: "tool-approval-response",
      approvalId: "approval-1",
      approved: true,
      reason: undefined,
    }],
  });
});

Deno.test("convertIncomingChatMessagesToModelMessages preserves completed tool results", async () => {
  const { modelMessages, uiMessages } = await convertIncomingChatMessagesToModelMessages(
    [
      {
        id: "user-1",
        role: "user",
        content: "Create Alpha",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "objects_create",
            input: { name: "Alpha" },
          },
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "objects_create",
            output: { type: "json", value: { insertedId: "507f1f77bcf86cd799439099" } },
          },
        ],
      },
    ],
    {
      objects_create: objectsCreateTool,
    },
  );

  expect(uiMessages[1].parts).toEqual([
    {
      type: "tool-objects_create",
      toolCallId: "call-1",
      input: { name: "Alpha" },
      output: { insertedId: "507f1f77bcf86cd799439099" },
      providerExecuted: undefined,
      state: "output-available",
    },
  ]);
  expect(modelMessages[2]).toEqual({
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "objects_create",
      output: { type: "json", value: { insertedId: "507f1f77bcf86cd799439099" } },
    }],
  });
});
