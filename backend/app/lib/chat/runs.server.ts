import { ObjectId } from "bson";
import type { ChatRunState, ChatToolPolicy } from "@myceliasdk/messengers.ts";
import {
  publishChatRunChanged,
  publishChatUpdated,
} from "@/lib/chat/events.server.ts";

export type ChatMongoCaller = (
  request: any,
) => Promise<any>;

const TERMINAL_RUN_STATES = new Set<ChatRunState>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const ALLOWED_PREVIOUS_STATES: Record<ChatRunState, ChatRunState[]> = {
  submitted: ["submitted", "needs_approval"],
  streaming: ["submitted", "streaming"],
  needs_approval: ["streaming", "needs_approval"],
  completed: ["streaming", "completed"],
  failed: ["submitted", "streaming", "needs_approval", "failed"],
  cancelled: ["submitted", "streaming", "cancelled"],
  interrupted: [
    "submitted",
    "streaming",
    "needs_approval",
    "interrupted",
  ],
};

export interface ChatRunEvents {
  runChanged: typeof publishChatRunChanged;
  chatUpdated: typeof publishChatUpdated;
}

const DEFAULT_CHAT_RUN_EVENTS: ChatRunEvents = {
  runChanged: publishChatRunChanged,
  chatUpdated: publishChatUpdated,
};

export interface StartChatRunInput {
  principal: string;
  chatId: string;
  runId: string;
  requestId: string;
  requestedModel?: string;
  toolPolicy: ChatToolPolicy;
  continuation?: boolean;
}

export interface StartChatRunResult {
  started: boolean;
  state: ChatRunState;
  toolPolicy: ChatToolPolicy;
}

export async function startChatRun(
  mongo: ChatMongoCaller,
  input: StartChatRunInput,
  events: ChatRunEvents = DEFAULT_CHAT_RUN_EVENTS,
): Promise<StartChatRunResult> {
  const now = new Date();
  const chatObjectId = new ObjectId(input.chatId);
  const existing = await mongo({
    action: "findOne",
    collection: "chat_runs",
    query: { userId: input.principal, runId: input.runId },
    options: {
      projection: { chatId: 1, startedAt: 1, state: 1, toolPolicy: 1 },
    },
  });
  if (existing && existing.chatId?.toString() !== input.chatId) {
    throw new Error("Chat run ID is already in use");
  }
  if (
    existing &&
    (!input.continuation || existing.state !== "needs_approval")
  ) {
    return {
      started: false,
      state: existing.state,
      toolPolicy: existing.toolPolicy ?? input.toolPolicy,
    };
  }
  const startedAt = existing?.startedAt ?? now;
  const runTransition = await mongo({
    action: "updateOne",
    collection: "chat_runs",
    query: {
      userId: input.principal,
      runId: input.runId,
      chatId: chatObjectId,
      ...(existing ? { state: "needs_approval" } : {}),
    },
    update: {
      $setOnInsert: {
        chatId: chatObjectId,
        userId: input.principal,
        runId: input.runId,
        startedAt,
        createdAt: now,
        toolPolicy: input.toolPolicy,
      },
      $set: {
        state: "submitted",
        requestId: input.requestId,
        ...(input.requestedModel
          ? { requestedModel: input.requestedModel }
          : {}),
        updatedAt: now,
      },
      $addToSet: { requestIds: input.requestId },
      $unset: { error: "", finishedAt: "" },
    },
    options: { upsert: !existing },
  });
  if (existing && runTransition?.matchedCount === 0) {
    return {
      started: false,
      state: existing.state,
      toolPolicy: existing.toolPolicy ?? input.toolPolicy,
    };
  }
  await mongo({
    action: "updateOne",
    collection: "chats",
    query: {
      _id: chatObjectId,
      userId: input.principal,
      platform: "mycelia",
    },
    update: {
      $set: {
        activeRunId: input.runId,
        lastRun: {
          runId: input.runId,
          state: "submitted",
          startedAt,
          updatedAt: now,
        },
      },
    },
  });
  await events.runChanged(
    input.principal,
    input.chatId,
    input.runId,
    "submitted",
  );
  return {
    started: true,
    state: "submitted",
    toolPolicy: existing?.toolPolicy ?? input.toolPolicy,
  };
}

export interface UpdateChatRunInput {
  principal: string;
  chatId: string;
  runId: string;
  state: ChatRunState;
  error?: string;
  requestedModel?: string;
  actualModel?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  usage?: unknown;
  finishReason?: string;
}

export async function updateChatRunState(
  mongo: ChatMongoCaller,
  input: UpdateChatRunInput,
  events: ChatRunEvents = DEFAULT_CHAT_RUN_EVENTS,
): Promise<boolean> {
  const now = new Date();
  const terminal = TERMINAL_RUN_STATES.has(input.state);
  const runFields = {
    state: input.state,
    updatedAt: now,
    ...(terminal ? { finishedAt: now } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.requestedModel ? { requestedModel: input.requestedModel } : {}),
    ...(input.actualModel ? { actualModel: input.actualModel } : {}),
    ...(input.providerProfileId
      ? { providerProfileId: input.providerProfileId }
      : {}),
    ...(input.providerProfileName
      ? { providerProfileName: input.providerProfileName }
      : {}),
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
    ...(input.finishReason ? { finishReason: input.finishReason } : {}),
  };
  const runUpdate = await mongo({
    action: "updateOne",
    collection: "chat_runs",
    query: {
      userId: input.principal,
      runId: input.runId,
      chatId: new ObjectId(input.chatId),
      state: { $in: ALLOWED_PREVIOUS_STATES[input.state] },
    },
    update: { $set: runFields },
  });
  if (runUpdate?.matchedCount === 0) return false;

  const chatUpdate = await mongo({
    action: "updateOne",
    collection: "chats",
    query: {
      _id: new ObjectId(input.chatId),
      userId: input.principal,
      platform: "mycelia",
      activeRunId: input.runId,
    },
    update: {
      $set: {
        "lastRun.runId": input.runId,
        "lastRun.state": input.state,
        "lastRun.updatedAt": now,
        ...(terminal ? { "lastRun.finishedAt": now } : {}),
        ...(input.error ? { "lastRun.error": input.error } : {}),
        ...(input.actualModel ? { lastResponseModel: input.actualModel } : {}),
        ...(input.providerProfileId
          ? { lastResponseProviderId: input.providerProfileId }
          : {}),
        ...(input.providerProfileName
          ? { lastResponseProviderName: input.providerProfileName }
          : {}),
      },
      ...(terminal
        ? { $unset: { activeRunId: "" } }
        : { $unset: { "lastRun.finishedAt": "", "lastRun.error": "" } }),
    },
  });
  const isCurrent = Boolean(chatUpdate?.matchedCount);
  if (isCurrent) {
    await Promise.all([
      events.runChanged(
        input.principal,
        input.chatId,
        input.runId,
        input.state,
        input.error,
      ),
      events.chatUpdated(input.principal, input.chatId, "run"),
    ]);
  }
  return isCurrent;
}
