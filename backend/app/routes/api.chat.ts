import type { Request, Response } from "express";
import { stepCountIs, streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { type Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { createAiSdkToolsFromResources } from "@/lib/mcp/ai-sdk-adapter.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { getOrCreatePersonByMessengerId } from "@/lib/messenger/sdk.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import {
  normalizeOpenAIBaseUrl,
  resolveConfiguredModel,
} from "@/lib/llm/model-routing.ts";
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

function hasAssistantOutput(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    if (part.type === "text") return Boolean(part.text?.trim());
    return part.type === "tool-call" || part.type === "tool-result";
  });
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
];

export async function apiChatHandler(req: Request, res: Response) {
  const auth = await authenticateOr401(req, res);
  const requestId = crypto.randomUUID();
  res.setHeader("X-Mycelia-Request-Id", requestId);

  // 2. Load or Create Chat Session (Persistence)
  const mongo = await getMongoResource(auth);

  let { messages, chatId } = req.body;
  let selectedChatModel: string | undefined;
  try {
    selectedChatModel = normalizeChatModel(req.body?.model);
  } catch (error) {
    res.status(400).json({
      error: getErrorMessage(error),
      requestId,
    });
    return;
  }

  // Normalize messages for AI SDK v6 compatibility
  // Claude requires that each tool_result has a matching tool_use in the previous message
  if (Array.isArray(messages)) {
    const normalizedMessages: any[] = [];

    for (const msg of messages) {
      // Map 'parts' to 'content' if needed
      const content = msg.content ?? msg.parts;

      if (msg.role === "assistant" && Array.isArray(content)) {
        // Extract tool-call and tool-result/tool-error parts
        const toolCalls: any[] = [];
        const toolResults: any[] = [];
        const otherContent: any[] = [];

        for (const part of content) {
          if (part.type === "tool-result") {
            toolResults.push({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: part.output,
            });
          } else if (part.type === "tool-error") {
            // Handle tool errors the same as tool results - they are responses to tool calls
            // Use 'error-text' output type for AI SDK compatibility
            const errorMessage = part.error?.errmsg || part.error?.message ||
              JSON.stringify(part.error) || "Tool execution failed";
            toolResults.push({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: { type: "error-text", value: errorMessage },
            });
          } else if (part.type === "tool-call") {
            toolCalls.push({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            });
          } else if (part.type === "text") {
            otherContent.push({ type: "text", text: part.text });
          }
          // Skip internal SDK markers like "step-start" - they shouldn't be sent back
        }

        // Build cleaned content: text + tool-calls only
        const cleanedContent = [...otherContent, ...toolCalls];

        // Get the set of tool-call IDs in this message
        const toolCallIds = new Set(toolCalls.map((tc) => tc.toolCallId));

        // Only include tool-results that have matching tool-calls in THIS message
        const matchingToolResults = toolResults.filter((tr) =>
          toolCallIds.has(tr.toolCallId)
        );
        const orphanedToolResults = toolResults.filter((tr) =>
          !toolCallIds.has(tr.toolCallId)
        );

        if (orphanedToolResults.length > 0) {
          console.warn(
            `[apiChatHandler] Dropping ${orphanedToolResults.length} orphaned tool-results without matching tool-calls:`,
            orphanedToolResults.map((tr) => tr.toolCallId),
          );
        }

        // Add assistant message with cleaned content (only if it has content)
        if (cleanedContent.length > 0) {
          normalizedMessages.push({
            role: "assistant",
            content: cleanedContent,
          });

          // Only add tool message if we have matching tool-results
          if (matchingToolResults.length > 0) {
            normalizedMessages.push({
              role: "tool",
              content: matchingToolResults,
            });
          }
        }
      } else if (msg.role === "tool" && Array.isArray(content)) {
        // Skip tool messages coming from the client - they should be reconstructed from assistant messages
        // This prevents orphaned tool-result messages
        console.warn(
          "[apiChatHandler] Skipping orphaned tool message from client",
        );
        continue;
      } else if (msg.role === "user" && Array.isArray(content)) {
        // Clean user message content parts
        const cleanedContent = content.map((part: any) => {
          if (part.type === "text") {
            return { type: "text", text: part.text };
          }
          return part;
        });
        normalizedMessages.push({ role: "user", content: cleanedContent });
      } else {
        // Pass through other messages
        normalizedMessages.push({ role: msg.role, content });
      }
    }

    messages = normalizedMessages;
  }

  // Debug: Log normalized messages
  console.log(
    "[apiChatHandler] Normalized messages:",
    JSON.stringify(messages, null, 2),
  );

  let activeChatId: string | undefined = chatId;
  let chatModel = selectedChatModel;
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
    if (selectedChatModel && selectedChatModel !== chat.model) {
      await mongo({
        action: "updateOne",
        collection: "chats",
        query: { _id: new ObjectId(activeChatId.toString()) },
        update: { $set: { model: selectedChatModel } },
      });
    }
  }

  // Save user message
  const lastMessage = messages[messages.length - 1];
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

  await mongo({
    action: "insertOne",
    collection: "messages",
    doc: {
      _id: userMessageId,
      chatId: new ObjectId(activeChatId),
      senderId: userPersonId,
      text: typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content),
      platform: "mycelia",
      externalId: userMessageId.toString(),
      timestamp: new Date(),
      createdAt: new Date(),
      raw: { role: "user", content: lastMessage.content },
    },
  });

  // Setup tools with approval requirements for destructive operations
  const resources = defaultResourceManager.listResources().filter((resource) =>
    RESOURCES_FOR_AI.includes(resource.code)
  );
  const tools = createAiSdkToolsFromResources(resources, auth, {
    toolsRequiringApproval: TOOLS_REQUIRING_APPROVAL,
  });

  // Fetch System Prompt
  let systemPrompt =
    "You are Mycelia, an intelligent AI assistant. You have access to various tools to help the user. Use them when necessary.";

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

  // Get inference provider using stateless env vars first, MongoDB fallback
  const llmResource = new LLMResource();
  const inference = await llmResource.getInferenceProvider();
  if (!inference?.baseUrl || !inference?.apiKey) {
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

  // A per-chat override wins. Chats without one inherit the active provider
  // preset's chat default once, so later preset changes do not silently alter
  // existing conversations.
  const baseModel = Deno.env.get("BASE_MODEL");
  const requestedModel = chatModel || inference.chatModel ||
    inference.defaultAlias ||
    inference.model || baseModel || "medium";
  const actualModel = resolveConfiguredModel(requestedModel, {
    defaultModel: inference.model,
    baseModel,
    smallModel: inference.smallModel || Deno.env.get("MODEL_SMALL"),
    mediumModel: inference.mediumModel || Deno.env.get("MODEL_MEDIUM"),
    largeModel: inference.largeModel || Deno.env.get("MODEL_LARGE"),
  });

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

  console.info("[apiChatHandler] Starting chat request", {
    requestId,
    chatId: activeChatId,
    requestedModel,
    actualModel,
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

  const persistAssistantMessage = async (
    content: unknown,
    usage: unknown,
    extraRaw: Record<string, unknown> = {},
  ) => {
    const assistantMessageId = new ObjectId();
    const assistantPersonId = await getAssistantPersonId();

    await mongo({
      action: "insertOne",
      collection: "messages",
      doc: {
        _id: assistantMessageId,
        chatId: new ObjectId(activeChatId),
        senderId: assistantPersonId,
        text: typeof content === "string" ? content : JSON.stringify(content),
        platform: "mycelia",
        externalId: assistantMessageId.toString(),
        timestamp: new Date(),
        createdAt: new Date(),
        raw: {
          role: "assistant",
          usage,
          content,
          requestedModel,
          model: actualModel,
          requestId,
          ...extraRaw,
        },
      },
    });

    await mongo({
      action: "updateOne",
      collection: "chats",
      query: { _id: new ObjectId(activeChatId) },
      update: { $set: { lastMessageDate: new Date() } },
    });
  };

  try {
    const stream = streamText({
      model: createOpenAI({
        baseURL: normalizeOpenAIBaseUrl(inference.baseUrl),
        apiKey: inference.apiKey,
      }).chat(actualModel),
      tools,
      stopWhen: stepCountIs(5),
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ] as any,
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
      async onStepFinish(result) {
        const { content, usage, finishReason } = result as any;

        // Some providers emit an empty terminal step. Do not persist it as a
        // misleading "Empty message"; the final callback below records one
        // explicit diagnostic only when the whole response is empty.
        if (!hasAssistantOutput(content)) return;

        await persistAssistantMessage(content, usage, { finishReason });

        // Generate title for new chats after first assistant response
        if (isNewChat) {
          isNewChat = false; // Only generate once
          const firstUserMessage = messages.find((m: any) => m.role === "user");
          if (firstUserMessage) {
            const userContent = typeof firstUserMessage.content === "string"
              ? firstUserMessage.content
              : Array.isArray(firstUserMessage.content)
              ? firstUserMessage.content.map((p: any) => p.text || "").join(" ")
              : "";
            if (userContent.trim()) {
              // Run title generation in background (don't await)
              void generateChatTitle(
                mongo,
                activeChatId!,
                userContent.trim(),
                auth,
              );
            }
          }
        }
      },
      async onFinish(result) {
        const hasOutput = result.steps.some((step) =>
          hasAssistantOutput(step.content)
        );
        if (hasOutput) return;

        const errorMessage =
          `Model "${actualModel}" completed without text or a tool result`;
        console.error("[apiChatHandler] Empty model response", {
          requestId,
          chatId: activeChatId,
          requestedModel,
          actualModel,
          finishReason: result.finishReason,
        });
        await persistAssistantMessage([], result.totalUsage, {
          finishReason: result.finishReason,
          error: {
            type: "empty_response",
            message: errorMessage,
          },
        });
      },
    });

    // Pipe the stream to the Express response with Chat ID header
    res.setHeader("X-Mycelia-Chat-Id", activeChatId!);
    stream.pipeUIMessageStreamToResponse(res, {
      messageMetadata: () => ({
        requestedModel,
        model: actualModel,
        requestId,
      }),
      onError: (error) => getClientChatError(error, actualModel, requestId),
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
