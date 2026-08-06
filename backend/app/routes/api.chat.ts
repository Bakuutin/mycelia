import type { Request, Response } from "express";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { type Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { createAiSdkToolsFromResources } from "@/lib/mcp/ai-sdk-adapter.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { getOrCreatePersonByMessengerId } from "@/lib/messenger/sdk.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import {
  getEnabledLlmProviders,
  resolveProviderModel,
  selectLlmProviders,
} from "@/lib/llm/provider-routing.ts";
import { normalizeOpenAIBaseUrl } from "@/lib/llm/model-routing.ts";
import { ObjectId } from "bson";

const RESOURCES_FOR_AI = ["search", "objects", "docs", "mongo"];

const MAX_CHAT_MODEL_LENGTH = 200;

function normalizeChatModel(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error("The selected model must be a string");
  }

  const model = value.trim();
  if (!model) throw new Error("The selected model cannot be empty");
  if (model.length > MAX_CHAT_MODEL_LENGTH) {
    throw new Error(
      `The selected model cannot exceed ${MAX_CHAT_MODEL_LENGTH} characters`,
    );
  }
  return model;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    error && typeof error === "object" && "message" in error &&
    typeof error.message === "string" && error.message.trim()
  ) {
    return error.message;
  }
  return String(error || "Unknown inference error");
}

function getClientChatError(
  error: unknown,
  model: string,
  requestId: string,
): string {
  const detail = getErrorMessage(error).replace(/\s+/g, " ").slice(0, 800);
  return `Model "${model}" failed: ${detail}. Request ID: ${requestId}. ` +
    "Check backend logs for [apiChatHandler] and this request ID.";
}

async function generateChatTitle(
  mongo: any,
  chatId: string,
  userMessage: string,
  auth: Auth,
): Promise<void> {
  try {
    const llm = await auth.getResource("llm");

    const completion = await llm({
      action: "completions",
      model: "small",
      session_id: "chat:title",
      messages: [
        {
          role: "system",
          content:
            "Generate a very short title (3-6 words) for a chat conversation based on the user's first message. Return ONLY the title, no quotes, no formatting, no explanation.",
        },
        { role: "user", content: userMessage },
      ],
    });

    const title = completion.choices[0]?.message?.content?.trim();
    if (title && title.length > 0 && title.length < 100) {
      await mongo({
        action: "updateOne",
        collection: "chats",
        query: { _id: new ObjectId(chatId) },
        update: { $set: { name: title, title: title } },
      });
      console.log(
        `[generateChatTitle] Generated title for chat ${chatId}: "${title}"`,
      );
    }
  } catch (error) {
    console.error("[generateChatTitle] Failed to generate chat title:", error);
  }
}

// Tools that require user confirmation before execution
// These can modify or delete user data
const TOOLS_REQUIRING_APPROVAL = [
  "objects_create", // Can create arbitrary objects
  "objects_update", // Can modify existing data
  "objects_delete", // Can permanently delete data
  "objects_merge", // Deletes the losing duplicates and re-points edges
  "objects_split", // Moves relationships/aliases into a new object
];

// The chat assistant only gets read access to raw mongo — all writes must go
// through the approval-gated objects_* tools. (The MCP server keeps full
// access; this filter applies to /api/chat only.)
const MONGO_READONLY_TOOLS = new Set([
  "mongo_find",
  "mongo_findOne",
  "mongo_aggregate",
  "mongo_count",
  "mongo_listIndexes",
  "mongo_getFirstBatch",
  "mongo_getMore",
]);

// Internal job-coordination actions that must not be exposed to the chat LLM
const CHAT_EXCLUDED_TOOLS = new Set([
  "objects_claimSummarization",
  "objects_releaseSummarization",
]);

export const chatToolFilter = (name: string): boolean =>
  !CHAT_EXCLUDED_TOOLS.has(name) &&
  (!name.startsWith("mongo_") || MONGO_READONLY_TOOLS.has(name));

/**
 * The UI message stream serializes absent optional part fields as explicit
 * nulls (title, output, rawInput, errorText, preliminary, providerMetadata…),
 * but validateUIMessages only accepts them as present-or-absent. Strip every
 * null-valued field from parts so round-tripped client state validates.
 */
export function sanitizeUIMessages(messages: unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const msg = message as Record<string, unknown>;
    if (!Array.isArray(msg.parts)) return message;
    return {
      ...msg,
      parts: msg.parts.map((part) => {
        if (!part || typeof part !== "object") return part;
        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(part)) {
          if (value !== null) cleaned[key] = value;
        }
        return cleaned;
      }),
    };
  });
}

export async function apiChatHandler(req: Request, res: Response) {
  const auth = await authenticateOr401(req, res);
  const requestId = crypto.randomUUID();
  res.setHeader("X-Mycelia-Request-Id", requestId);

  // 2. Load or Create Chat Session (Persistence)
  const mongo = await getMongoResource(auth);

  let { messages, chatId } = req.body;
  let selectedChatModel: string | undefined;
  // Explicit provider pin from the model picker. null clears an earlier pin;
  // undefined leaves the stored per-chat pin untouched.
  const rawProviderProfileId = req.body?.providerProfileId;
  const selectedProviderProfileId: string | null | undefined =
    typeof rawProviderProfileId === "string" && rawProviderProfileId.trim()
      ? rawProviderProfileId.trim().slice(0, 120)
      : rawProviderProfileId === null
      ? null
      : undefined;
  try {
    selectedChatModel = normalizeChatModel(req.body?.model);
  } catch (error) {
    res.status(400).json({
      error: getErrorMessage(error),
      requestId,
    });
    return;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      error: "Request body must include a non-empty messages array",
      requestId,
    });
    return;
  }

  // Setup tools with approval requirements for destructive operations.
  // Built before message conversion because convertToModelMessages needs the
  // tool set to map tool parts (incl. approval responses) correctly.
  const resources = defaultResourceManager.listResources().filter((resource) =>
    RESOURCES_FOR_AI.includes(resource.code)
  );
  const tools = createAiSdkToolsFromResources(resources, auth, {
    toolsRequiringApproval: TOOLS_REQUIRING_APPROVAL,
    toolFilter: chatToolFilter,
  });

  // Validate and convert UIMessages (useChat wire format) into ModelMessages.
  // This preserves tool-approval requests/responses so streamText can execute
  // approved tools; the previous hand-rolled normalizer silently dropped them.
  let uiMessages: UIMessage[];
  let modelMessages;
  try {
    uiMessages = await validateUIMessages({
      messages: sanitizeUIMessages(messages),
    });
    modelMessages = await convertToModelMessages(uiMessages, {
      tools,
      ignoreIncompleteToolCalls: true,
    });
  } catch (error) {
    console.warn("[apiChatHandler] Failed to convert chat messages", {
      requestId,
      error: getErrorMessage(error),
    });
    res.status(400).json({
      error: `Invalid chat message format: ${
        getErrorMessage(error)
      }. Reloading the chat usually fixes this.`,
      requestId,
    });
    return;
  }

  console.debug("[apiChatHandler] Converted messages", {
    requestId,
    uiRoles: uiMessages.map((m) => m.role),
    modelRoles: modelMessages.map((m) => m.role),
  });

  let activeChatId: string | undefined = chatId;
  let chatModel = selectedChatModel;
  let chatProviderProfileId: string | undefined =
    selectedProviderProfileId ?? undefined;
  let isNewChat = false;

  if (!activeChatId) {
    isNewChat = true;
    const newChatId = new ObjectId();
    const chatResult = await mongo({
      action: "insertOne",
      collection: "chats",
      doc: {
        _id: newChatId,
        userId: auth.principal, // Auth object uses principal as user identifier
        title: "New Chat", // This might be renamed later by AI or user
        name: "New Chat", // Align with new schema 'name'
        ...(chatModel ? { model: chatModel } : {}),
        ...(selectedProviderProfileId
          ? { providerProfileId: selectedProviderProfileId }
          : {}),
        platform: "mycelia",
        externalId: newChatId.toString(),
        type: "private",
        createdAt: new Date(),
        lastMessageDate: new Date(),
      },
    });
    activeChatId = chatResult.insertedId.toString();
  } else {
    // Get Chat Model Config & Verify Ownership
    const chat = await mongo({
      action: "findOne",
      collection: "chats",
      query: {
        _id: new ObjectId(activeChatId.toString()),
        userId: auth.principal,
      },
    });

    if (!chat) {
      res.status(404).json({ error: "Chat not found or access denied" });
      return;
    }
    chatModel = selectedChatModel || chat.model;
    chatProviderProfileId = selectedProviderProfileId === undefined
      ? (typeof chat.providerProfileId === "string"
        ? chat.providerProfileId
        : undefined)
      : selectedProviderProfileId ?? undefined;
    const pinChanged = selectedProviderProfileId !== undefined &&
      (selectedProviderProfileId ?? undefined) !==
        (typeof chat.providerProfileId === "string"
          ? chat.providerProfileId
          : undefined);
    if ((selectedChatModel && selectedChatModel !== chat.model) || pinChanged) {
      await mongo({
        action: "updateOne",
        collection: "chats",
        query: { _id: new ObjectId(activeChatId.toString()) },
        update: {
          $set: {
            ...(selectedChatModel ? { model: selectedChatModel } : {}),
            ...(selectedProviderProfileId
              ? { providerProfileId: selectedProviderProfileId }
              : {}),
          },
          ...(selectedProviderProfileId === null
            ? { $unset: { providerProfileId: "" } }
            : {}),
        },
      });
    }
  }

  // Save user message. Approval auto-resubmits end with an assistant message
  // (the user only approved/denied a tool call) — skip persistence then, so
  // the previous user message is not duplicated.
  const lastUiMessage = uiMessages[uiMessages.length - 1];
  if (lastUiMessage.role === "user") {
    const userMessageId = new ObjectId();

    // Get or create Person for the user
    // Use auth.principal as the external ID for mycelia platform
    const userPersonResult = await getOrCreatePersonByMessengerId({
      platform: "mycelia",
      externalId: auth.principal,
      name: "User",
      auth,
    });
    const userPersonId = userPersonResult._id;

    const userText = lastUiMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    await mongo({
      action: "insertOne",
      collection: "messages",
      doc: {
        _id: userMessageId,
        chatId: new ObjectId(activeChatId),
        senderId: userPersonId,
        text: userText,
        platform: "mycelia",
        externalId: userMessageId.toString(),
        timestamp: new Date(),
        createdAt: new Date(),
        raw: { role: "user", content: userText, uiMessage: lastUiMessage },
      },
    });
  }

  // Fetch System Prompt
  let systemPrompt =
    "You are Mycelia, an intelligent AI assistant with access to the user's personal knowledge base. Use your tools to search, create, and edit data when asked. " +
    "Always reference objects you find or change as markdown links with relative paths, e.g. [Name](/objects/<id>), using ids from tool results.";

  const config = await getServerConfig();
  try {
    if (config.prompts?.chat_system) {
      const promptDoc = await mongo({
        action: "findOne",
        collection: "prompts",
        query: { _id: config.prompts.chat_system },
      });
      if (promptDoc && promptDoc.text) {
        systemPrompt = promptDoc.text;
      }
    }
  } catch (e) {
    console.warn("Failed to load system prompt from config, using default.", e);
  }

  // Model-aware provider routing: the chat request goes to the provider that
  // can actually serve the requested model — an explicitly pinned provider
  // wins, then providers advertising the model, then priority order.
  const llmResource = new LLMResource();
  const allProviders = await llmResource.getInferenceProviders();
  const enabledProviders = getEnabledLlmProviders(allProviders);
  if (enabledProviders.length === 0) {
    console.error("[apiChatHandler] Inference provider is not configured", {
      requestId,
      chatId: activeChatId,
      requestedModel: chatModel,
    });
    res.status(500).json({
      error:
        "Inference provider not configured. Please configure it in server settings.",
      model: chatModel,
      requestId,
    });
    return;
  }

  // A per-chat override wins. Chats without one inherit the primary
  // provider's chat default once, so later preset changes do not silently
  // alter existing conversations.
  const primaryProvider = enabledProviders[0];
  const requestedModel = chatModel || primaryProvider.chatModel ||
    primaryProvider.defaultAlias || "medium";

  let chatProvider = selectLlmProviders(allProviders, requestedModel)[0];
  if (chatProviderProfileId) {
    const pinnedProvider = allProviders.find((provider) =>
      provider.id === chatProviderProfileId
    );
    if (!pinnedProvider) {
      res.status(400).json({
        error:
          `The provider pinned to this chat no longer exists. Pick a model again in the model selector.`,
        model: requestedModel,
        requestId,
      });
      return;
    }
    if (!pinnedProvider.enabled) {
      res.status(400).json({
        error:
          `Provider "${pinnedProvider.name}" is disabled. Enable it in Settings → Inference or pick a model from another provider.`,
        model: requestedModel,
        requestId,
      });
      return;
    }
    chatProvider = pinnedProvider;
  }
  if (!chatProvider) {
    res.status(400).json({
      error:
        `No enabled LLM provider can serve model "${requestedModel}". Check alias mappings in Settings → Inference or pick another model.`,
      model: requestedModel,
      requestId,
    });
    return;
  }
  const resolvedChatModel = resolveProviderModel(requestedModel, chatProvider);
  if (!resolvedChatModel) {
    res.status(400).json({
      error:
        `Provider "${chatProvider.name}" has no model mapped for "${requestedModel}". Map the alias in Settings → Inference or pick a concrete model.`,
      model: requestedModel,
      requestId,
    });
    return;
  }
  const actualModel = resolvedChatModel;

  if (!chatModel) {
    await mongo({
      action: "updateOne",
      collection: "chats",
      query: { _id: new ObjectId(activeChatId) },
      update: { $set: { model: requestedModel } },
    });
    chatModel = requestedModel;
  }
  res.setHeader("X-Mycelia-Model", actualModel);
  res.setHeader("X-Mycelia-Provider", chatProvider.name);

  console.info("[apiChatHandler] Starting chat request", {
    requestId,
    chatId: activeChatId,
    requestedModel,
    actualModel,
    providerProfileId: chatProvider.id,
    providerProfileName: chatProvider.name,
    pinned: Boolean(chatProviderProfileId),
  });

  let assistantPersonIdPromise: Promise<ObjectId> | undefined;
  const getAssistantPersonId = () => {
    assistantPersonIdPromise ??= getOrCreatePersonByMessengerId({
      platform: "mycelia",
      externalId: "system_assistant",
      name: "Mycelia Assistant",
      auth,
    }).then((result) => result._id);
    return assistantPersonIdPromise;
  };

  // A UIMessage renders something when it has non-empty text or a tool part.
  const hasRenderableParts = (message: UIMessage): boolean =>
    message.parts.some((part) =>
      (part.type === "text" && Boolean(part.text?.trim())) ||
      part.type.startsWith("tool-") || part.type === "dynamic-tool"
    );

  // Usage is only reported by streamText's onFinish; the UI-stream onFinish
  // (which persists the message) runs when the stream closes, after it.
  let totalUsage: unknown;

  // Persist the assistant response as a UIMessage, upserted by its id: a
  // post-approval continuation extends the SAME message, so the approval
  // request and response stay together in one stored document.
  const persistAssistantUIMessage = async (
    responseMessage: UIMessage,
    extraRaw: Record<string, unknown> = {},
  ) => {
    const assistantPersonId = await getAssistantPersonId();
    const messageId = ObjectId.isValid(responseMessage.id)
      ? new ObjectId(responseMessage.id)
      : new ObjectId();
    const text = responseMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const now = new Date();

    await mongo({
      action: "updateOne",
      collection: "messages",
      query: { _id: messageId },
      update: {
        $set: {
          chatId: new ObjectId(activeChatId),
          senderId: assistantPersonId,
          text,
          platform: "mycelia",
          externalId: messageId.toString(),
          timestamp: now,
          raw: {
            role: "assistant",
            uiMessage: responseMessage,
            usage: totalUsage,
            requestedModel,
            model: actualModel,
            providerProfileId: chatProvider.id,
            providerProfileName: chatProvider.name,
            requestId,
            ...extraRaw,
          },
        },
        $setOnInsert: { createdAt: now },
      },
      options: { upsert: true },
    });

    await mongo({
      action: "updateOne",
      collection: "chats",
      query: { _id: new ObjectId(activeChatId) },
      update: { $set: { lastMessageDate: now } },
    });
  };

  try {
    const stream = streamText({
      model: createOpenAI({
        baseURL: normalizeOpenAIBaseUrl(chatProvider.baseUrl),
        apiKey: chatProvider.apiKey,
      }).chat(actualModel),
      tools,
      stopWhen: stepCountIs(5),
      messages: [
        {
          role: "system",
          // Current time lets the model resolve "tomorrow"/"last week"
          content: `${systemPrompt}\n\nCurrent date and time: ${
            new Date().toISOString()
          }`,
        },
        ...modelMessages,
      ],
      onError: (errorEvent: any) => {
        const error = errorEvent?.error;
        console.error("[apiChatHandler] Chat stream failed", {
          requestId,
          chatId: activeChatId,
          requestedModel,
          actualModel,
          error: getErrorMessage(error),
        });
      },
      onFinish(result) {
        totalUsage = result.totalUsage;
      },
    });

    // Pipe the stream to the Express response with Chat ID header
    res.setHeader("X-Mycelia-Chat-Id", activeChatId!);
    stream.pipeUIMessageStreamToResponse(res, {
      originalMessages: uiMessages,
      generateMessageId: () => new ObjectId().toString(),
      messageMetadata: () => ({
        requestedModel,
        model: actualModel,
        requestId,
      }),
      onError: (error) => getClientChatError(error, actualModel, requestId),
      async onFinish({ responseMessage, isContinuation, finishReason }) {
        const isEmpty = !hasRenderableParts(responseMessage);
        if (isEmpty) {
          console.error("[apiChatHandler] Empty model response", {
            requestId,
            chatId: activeChatId,
            requestedModel,
            actualModel,
            finishReason,
          });
        }

        await persistAssistantUIMessage(responseMessage, {
          finishReason,
          isContinuation,
          ...(isEmpty
            ? {
              error: {
                type: "empty_response",
                message:
                  `Model "${actualModel}" completed without text or a tool result`,
              },
            }
            : {}),
        });

        // Generate title for new chats after the first assistant response
        if (isNewChat && !isEmpty) {
          isNewChat = false; // Only generate once
          const firstUserMessage = uiMessages.find((m) => m.role === "user");
          const userContent = firstUserMessage?.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(" ")
            .trim();
          if (userContent) {
            // Run title generation in background (don't await)
            void generateChatTitle(mongo, activeChatId!, userContent, auth);
          }
        }
      },
    });
  } catch (error) {
    console.error("[apiChatHandler] Chat request failed", {
      requestId,
      chatId: activeChatId,
      requestedModel,
      actualModel,
      error: getErrorMessage(error),
    });
    // If headers sent, we can't send json
    if (!res.headersSent) {
      res.status(500).json({
        error: getClientChatError(error, actualModel, requestId),
        model: actualModel,
        requestId,
      });
    }
  }
}
