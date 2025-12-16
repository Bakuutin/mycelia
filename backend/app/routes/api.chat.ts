import type { Request, Response } from "express";
import { ToolLoopAgent } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import { createAiSdkToolsFromResources } from "@/lib/mcp/ai-sdk-adapter.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { zServerConfig } from "@interfaces/config.ts";
import { getOrCreatePersonByMessengerId } from "@/lib/messenger/sdk.server.ts";
import { ObjectId } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

const RESOURCES_FOR_AI = ["mongo", "timeline", "objects"];

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

    const newChatId = new ObjectId();
    const chatResult = await db.collection("chats").insertOne({
      _id: newChatId,
      userId: auth.principal, // Auth object uses principal as user identifier
      title: 'New Chat', // This might be renamed later by AI or user
      name: 'New Chat', // Align with new schema 'name'
      model: "medium",
      platform: "mycelia",
      externalId: newChatId.toString(),
      type: "private",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageDate: new Date(),
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
  
  await db.collection("messages").insertOne({
    _id: userMessageId,
    chatId: new ObjectId(activeChatId),
    senderId: userPersonId,
    text: typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content),
    platform: "mycelia",
    externalId: userMessageId.toString(),
    timestamp: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    raw: { role: "user", content: lastMessage.content }
  });

  // Setup tools
  const resources = defaultResourceManager.listResources().filter(resource => RESOURCES_FOR_AI.includes(resource.code));

  const tools = createAiSdkToolsFromResources(resources, auth)

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
        
        const assistantMessageId = new ObjectId();
        
        // Get or create Person for the AI assistant
        const assistantPersonResult = await getOrCreatePersonByMessengerId({
          platform: "mycelia",
          externalId: "system_assistant",
          name: "Mycelia Assistant",
          auth,
        });
        const assistantPersonId = assistantPersonResult._id;
        
        await db.collection("messages").insertOne({
          _id: assistantMessageId,
          chatId: new ObjectId(activeChatId),
          senderId: assistantPersonId,
          text: typeof content === 'string' ? content : JSON.stringify(content),
          platform: "mycelia",
          externalId: assistantMessageId.toString(),
          timestamp: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          raw: { 
            role: "assistant",
            usage: totalUsage,
            content
          }
        });
        
        // Update chat timestamp
        await db.collection("chats").updateOne(
            { _id: new ObjectId(activeChatId) },
            { 
              $set: { 
                updatedAt: new Date(),
                lastMessageDate: new Date()
              } 
            }
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
