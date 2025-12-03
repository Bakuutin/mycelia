import type { Request, Response } from "express";
import { ToolLoopAgent } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import { createAiSdkToolsFromResources } from "@/lib/mcp/ai-sdk-adapter.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { zServerConfig } from "@interfaces/config.ts";
import { ObjectId } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

export async function apiChatHandler(req: Request, res: Response) {
  const auth = await authenticateOr401(req, res);

  // 2. Load or Create Chat Session (Persistence)
  const db = await getRootDB();

  let { messages, chatId } = req.body;

  // Normalize messages: map 'parts' to 'content' if needed (AI SDK Core format compatibility)
  if (Array.isArray(messages)) {
    messages = messages.map((msg: any) => {
      if (msg.parts && !msg.content) {
        return { ...msg, content: msg.parts };
      }
      return msg;
    });
  }

  let activeChatId: string | undefined = chatId;
  let chatModel = "medium";

  if (!activeChatId) {
    // Use medium model by default if creating new chat
    const llmResource = new LLMResource();
    const modelConfig = await llmResource.getModel("medium");

    if (!modelConfig) {
      res.status(500).json({ error: "Default model 'medium' not configured" });
      return;
    }

    const chatResult = await db.collection("chats").insertOne({
      userId: auth.principal, // Auth object uses principal as user identifier
      title: 'New Chat',
      model: "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    activeChatId = chatResult.insertedId.toString();
  } else {
    // 3. Get Chat Model Config & Verify Ownership
    const chat = await db.collection("chats").findOne({ 
      _id: new ObjectId(activeChatId),
      userId: auth.principal 
    });
    
    if (!chat) {
       res.status(404).json({ error: "Chat not found or access denied" });
       return;
    }
    chatModel = chat.model || "medium";
  }

  const llmResource = new LLMResource();
  const modelConfig = await llmResource.getModel(chatModel);

  if (!modelConfig) {
    res.status(500).json({ error: `Model '${chatModel}' not configured` });
    return;
  }

  // Save user message
  const lastMessage = messages[messages.length - 1];
  await db.collection("messages").insertOne({
    chatId: new ObjectId(activeChatId),
    role: "user",
    content: lastMessage.content,
    createdAt: new Date(),
  });

  // Setup tools
  const resources = defaultResourceManager.listResources();
  const tools = createAiSdkToolsFromResources(resources, auth);

  // Fetch System Prompt
  let systemPrompt = "You are Mycelia, an intelligent AI assistant. You have access to various tools to help the user. Use them when necessary.";

  try {
      const configDoc = await db.collection("configs").findOne({ _id: SERVER_CONFIG_ID });
      if (configDoc) {
          const config = zServerConfig.parse(configDoc);
          if (config.prompts.chat_system) {
              const promptDoc = await db.collection("prompts").findOne({ _id: config.prompts.chat_system });
              if (promptDoc && promptDoc.text) {
                  systemPrompt = promptDoc.text;
              }
          }
      }
  } catch (e) {
      console.warn("Failed to load system prompt from config, using default.", e);
  }

  try {
    const agent = new ToolLoopAgent({
      model: createOpenAI({
        baseURL: modelConfig.baseUrl,
        apiKey: modelConfig.apiKey,
      }).chat(modelConfig.name), 
      tools,
      instructions: systemPrompt,
      async onFinish(result) {
        console.log(result);
        const { content, usage: totalUsage } = result as any;
        
        await db.collection("messages").insertOne({
          chatId: new ObjectId(activeChatId),
          role: "assistant",
          content,
          usage: totalUsage, 
          createdAt: new Date(),
        });
        
        // Update chat timestamp
        await db.collection("chats").updateOne(
            { _id: new ObjectId(activeChatId) },
            { $set: { updatedAt: new Date() } }
        );
      },
    });

    const result = await agent.stream({
      messages,
    });

    // Pipe the stream to the Express response with Chat ID header
    res.setHeader("X-Mycelia-Chat-Id", activeChatId!);
    result.pipeUIMessageStreamToResponse(res);
  } catch (error) {
    console.error("Chat error:", error);
    // If headers sent, we can't send json
    if (!res.headersSent) {
        res.status(500).json({ error: "Failed to process chat request" });
    }
  }
}

