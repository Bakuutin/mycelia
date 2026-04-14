import type { Request, Response } from "express";
import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { authenticateOr401, type Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { createAiSdkToolsFromResources } from "@/lib/mcp/ai-sdk-adapter.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { getOrCreatePersonByMessengerId } from "@/lib/messenger/sdk.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import {
  convertIncomingChatMessagesToModelMessages,
  extractTextFromUIParts,
} from "@/lib/chat/uiMessages.ts";
import { ObjectId } from "bson";

const RESOURCES_FOR_AI = ["search", "objects", "docs", "mongo"];

async function generateChatTitle(
  mongo: any,
  chatId: string,
  userMessage: string,
  auth: Auth
): Promise<void> {
  try {
    const llm = await auth.getResource("llm");

    const completion = await llm({
      action: "completions",
      model: "small",
      messages: [
        { role: "system", content: "Generate a very short title (3-6 words) for a chat conversation based on the user's first message. Return ONLY the title, no quotes, no formatting, no explanation." },
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
      console.log(`[generateChatTitle] Generated title for chat ${chatId}: "${title}"`);
    }
  } catch (error) {
    console.error("[generateChatTitle] Failed to generate chat title:", error);
  }
}

// Tools that require user confirmation before execution
// These can modify or delete user data
const TOOLS_REQUIRING_APPROVAL = [
  "objects_create",  // Can create arbitrary objects
  "objects_update",  // Can modify existing data
  "objects_delete",  // Can permanently delete data
];

export async function apiChatHandler(req: Request, res: Response) {
  const auth = await authenticateOr401(req, res);

  // 2. Load or Create Chat Session (Persistence)
  const mongo = await getMongoResource(auth);

  const { messages: incomingMessages, chatId } = req.body;

  let activeChatId: string | undefined = chatId;
  let chatModel = "medium";
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
        title: 'New Chat', // This might be renamed later by AI or user
        name: 'New Chat', // Align with new schema 'name'
        model: "medium",
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
        userId: auth.principal
      },
    });

    if (!chat) {
       res.status(404).json({ error: "Chat not found or access denied" });
       return;
    }
    chatModel = chat.model || "medium";
  }
  // Setup tools with approval requirements for destructive operations
  const resources = defaultResourceManager.listResources().filter(resource => RESOURCES_FOR_AI.includes(resource.code));
  const tools = createAiSdkToolsFromResources(resources, auth, {
    toolsRequiringApproval: TOOLS_REQUIRING_APPROVAL,
  });
  const { uiMessages, modelMessages } = await convertIncomingChatMessagesToModelMessages(
    incomingMessages,
    tools,
  );

  console.log(
    "[apiChatHandler] Prepared chat messages",
    JSON.stringify({
      uiMessageCount: uiMessages.length,
      modelMessageCount: modelMessages.length,
      lastRole: uiMessages.at(-1)?.role,
    }),
  );

  const upsertStoredMessage = async ({
    senderId,
    externalId,
    timestamp,
    text,
    raw,
  }: {
    senderId: ObjectId;
    externalId: string;
    timestamp: Date;
    text: string;
    raw: Record<string, unknown>;
  }) => {
    const existingMessage = await mongo({
      action: "findOne",
      collection: "messages",
      query: {
        chatId: new ObjectId(activeChatId),
        platform: "mycelia",
        externalId,
      },
    });

    const messageDoc = {
      chatId: new ObjectId(activeChatId),
      senderId,
      text,
      platform: "mycelia",
      externalId,
      timestamp,
      raw,
    };

    if (existingMessage) {
      await mongo({
        action: "updateOne",
        collection: "messages",
        query: { _id: existingMessage._id },
        update: {
          $set: {
            ...messageDoc,
            updatedAt: new Date(),
          },
        },
      });
      return existingMessage._id;
    }

    const inserted = await mongo({
      action: "insertOne",
      collection: "messages",
      doc: {
        _id: new ObjectId(),
        ...messageDoc,
        createdAt: new Date(),
      },
    });

    return inserted.insertedId;
  };

  // Fetch System Prompt
  let systemPrompt = "You are Mycelia, an intelligent AI assistant. You have access to various tools to help the user. Use them when necessary.";

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
    res.status(500).json({ error: "Inference provider not configured. Please configure it in server settings." });
    return;
  }

  // Resolve model aliases (small/medium/large) to actual model names
  // Priority: BASE_MODEL env var > inference.mycelia.tech aliases > MODEL_* env vars > defaults
  function resolveModelAlias(modelName: string): string {
    // Highest priority: explicit BASE_MODEL override
    const baseModelOverride = Deno.env.get('BASE_MODEL');
    if (baseModelOverride) {
      return baseModelOverride;
    }

    // If using Mycelia inference gateway, pass through aliases (they handle it server-side)
    if (inference && inference.baseUrl.includes('inference.mycelia.tech')) {
      return modelName;
    }

    // Resolve aliases to actual model names for direct providers
    // Priority: MODEL_* env vars > BASE_MODEL > "medium" alias (requires BASE_MODEL to be set)
    const baseModel = Deno.env.get('BASE_MODEL');
    if (!baseModel) {
      // If no BASE_MODEL set, pass through the alias/model name as-is
      return modelName;
    }
    const aliases: Record<string, string> = {
      small: Deno.env.get('MODEL_SMALL') || baseModel,
      medium: Deno.env.get('MODEL_MEDIUM') || baseModel,
      large: Deno.env.get('MODEL_LARGE') || baseModel,
    };

    return aliases[modelName] || modelName;
  }

  // Use model from inference provider (env var), fallback to DB model or BASE_MODEL
  const baseModel = Deno.env.get('BASE_MODEL');
  const requestedModel = inference.model || chatModel || baseModel || "medium";
  const actualModel = resolveModelAlias(requestedModel);

  const lastUiMessage = uiMessages.at(-1);
  if (lastUiMessage?.role === "user") {
    const userText = extractTextFromUIParts(lastUiMessage.parts);

    // Get or create Person for the user.
    const userPersonResult = await getOrCreatePersonByMessengerId({
      platform: "mycelia",
      externalId: auth.principal,
      name: "User",
      auth,
    });

    await upsertStoredMessage({
      senderId: userPersonResult._id,
      externalId: lastUiMessage.id,
      timestamp: new Date(),
      text: userText,
      raw: {
        role: "user",
        parts: lastUiMessage.parts,
        content: userText,
      },
    });
  }

  try {
    const stream = streamText({
      model: createOpenAI({
        baseURL: inference.baseUrl,
        apiKey: inference.apiKey,
      }).chat(actualModel),
      tools,
      stopWhen: stepCountIs(5),
      messages: [
        { role: "system", content: systemPrompt },
        ...modelMessages,
      ] as any,
      onError: (errorEvent: any) => {
        const error = errorEvent?.error;
        console.error("[apiChatHandler] Stream error:", error?.message || error);
      },
    });

    const assistantPersonResult = await getOrCreatePersonByMessengerId({
      platform: "mycelia",
      externalId: "system_assistant",
      name: "Mycelia Assistant",
      auth,
    });
    const assistantPersonId = assistantPersonResult._id;

    // Pipe the stream to the Express response with Chat ID header
    res.setHeader("X-Mycelia-Chat-Id", activeChatId!);
    stream.pipeUIMessageStreamToResponse(res, {
      originalMessages: uiMessages,
      async onFinish({ responseMessage }) {
        const assistantText = extractTextFromUIParts(responseMessage.parts);

        await upsertStoredMessage({
          senderId: assistantPersonId,
          externalId: responseMessage.id,
          timestamp: new Date(),
          text: assistantText,
          raw: {
            role: "assistant",
            parts: responseMessage.parts,
            content: assistantText,
          },
        });

        await mongo({
          action: "updateOne",
          collection: "chats",
          query: { _id: new ObjectId(activeChatId) },
          update: {
            $set: {
              lastMessageDate: new Date(),
            },
          },
        });

        if (isNewChat) {
          isNewChat = false;
          const firstUserMessage = uiMessages.find((message) => message.role === "user");
          const firstUserText = firstUserMessage
            ? extractTextFromUIParts(firstUserMessage.parts).trim()
            : "";

          if (firstUserText) {
            void generateChatTitle(mongo, activeChatId!, firstUserText, auth);
          }
        }
      },
    });
  } catch (error) {
    console.error("[apiChatHandler] Chat error:", error);
    // If headers sent, we can't send json
    if (!res.headersSent) {
        res.status(500).json({ error: "Failed to process chat request" });
    }
    
  }
}
