import { expect } from "@std/expect";
import { ObjectId } from "bson";
import {
  type ChatRunEvents,
  startChatRun,
  updateChatRunState,
} from "./runs.server.ts";

const quietEvents = (): ChatRunEvents & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    runChanged: async (_principal, _chatId, _runId, state) => {
      calls.push(`run:${state}`);
    },
    chatUpdated: async () => {
      calls.push("chat");
    },
  };
};

Deno.test("duplicate run submission does not restart inference state", async () => {
  const chatId = new ObjectId().toString();
  const calls: any[] = [];
  const events = quietEvents();
  const result = await startChatRun(async (request) => {
    calls.push(request);
    if (request.action === "findOne") {
      return {
        chatId: new ObjectId(chatId),
        state: "streaming",
        toolPolicy: { mode: "none", enabledTools: [] },
      };
    }
    throw new Error(`Unexpected ${request.action}`);
  }, {
    principal: "owner-a",
    chatId,
    runId: "run-1",
    requestId: "request-2",
    toolPolicy: { mode: "auto", enabledTools: [] },
  }, events);

  expect(result).toEqual({
    started: false,
    state: "streaming",
    toolPolicy: { mode: "none", enabledTools: [] },
  });
  expect(calls).toHaveLength(1);
  expect(events.calls).toEqual([]);
});

Deno.test("approval continuation reuses the run and its original tool policy", async () => {
  const chatId = new ObjectId().toString();
  const calls: any[] = [];
  const events = quietEvents();
  const result = await startChatRun(async (request) => {
    calls.push(request);
    if (request.action === "findOne") {
      return {
        chatId: new ObjectId(chatId),
        state: "needs_approval",
        startedAt: new Date("2026-08-18T10:00:00Z"),
        toolPolicy: { mode: "custom", enabledTools: ["search_messages"] },
      };
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }, {
    principal: "owner-a",
    chatId,
    runId: "run-1",
    requestId: "request-2",
    toolPolicy: { mode: "auto", enabledTools: [] },
    continuation: true,
  }, events);

  expect(result.started).toBe(true);
  expect(result.toolPolicy).toEqual({
    mode: "custom",
    enabledTools: ["search_messages"],
  });
  expect(calls[1].query.state).toBe("needs_approval");
  expect(calls[1].options.upsert).toBe(false);
  expect(calls[2].query).toMatchObject({
    userId: "owner-a",
    platform: "mycelia",
  });
  expect(events.calls).toEqual(["run:submitted"]);
});

Deno.test("stale run completion cannot overwrite a newer chat run", async () => {
  const chatId = new ObjectId().toString();
  const calls: any[] = [];
  const events = quietEvents();
  const current = await updateChatRunState(async (request) => {
    calls.push(request);
    if (request.collection === "chat_runs") return { matchedCount: 1 };
    return { matchedCount: 0 };
  }, {
    principal: "owner-a",
    chatId,
    runId: "old-run",
    state: "completed",
    actualModel: "model-a",
  }, events);

  expect(current).toBe(false);
  expect(calls[1].query).toMatchObject({
    userId: "owner-a",
    platform: "mycelia",
    activeRunId: "old-run",
  });
  expect(events.calls).toEqual([]);
});
