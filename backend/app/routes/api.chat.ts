import type { Request, Response } from "express";
import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { createAiSdkToolsFromResources } from "@/lib/mcp/ai-sdk-adapter.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { getOrCreatePersonByMessengerId } from "@/lib/messenger/sdk.server.ts";
import { ObjectId } from "mongodb";

const RESOURCES_FOR_AI = ["search", "objects", "docs"];

export async function apiChatHandler(req: Request, res: Response) {
  const auth = await authenticateOr401(req, res);

  // 2. Load or Create Chat Session (Persistence)
  const db = await getRootDB();
  
  let { messages, chatId } = req.body;
  
  // Normalize messages for AI SDK v6 compatibility
  if (Array.isArray(messages)) {
    const normalizedMessages: any[] = [];
    
    for (const msg of messages) {
      // Map 'parts' to 'content' if needed
      const content = msg.content ?? msg.parts;
      
      if (msg.role === "assistant" && Array.isArray(content)) {
        // Extract tool-result parts and create separate tool messages
        const toolResults: any[] = [];
        const cleanedContent: any[] = [];
        
        for (const part of content) {
          if (part.type === "tool-result") {
            // Create a separate tool message for each tool-result
            toolResults.push({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: part.output,
            });
          } else if (part.type === "tool-call") {
            // Clean null values from tool-call parts
            cleanedContent.push({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            });
          } else if (part.type === "text") {
            cleanedContent.push({ type: "text", text: part.text });
          }
          // Skip internal SDK markers like "step-start" - they shouldn't be sent back
        }
        
        // Add assistant message with cleaned content
        if (cleanedContent.length > 0) {
          normalizedMessages.push({
            role: "assistant",
            content: cleanedContent,
          });
        }
        
        // Add tool message with all tool results
        if (toolResults.length > 0) {
          normalizedMessages.push({
            role: "tool",
            content: toolResults,
          });
        }
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

  let activeChatId: string | undefined = chatId;
  let chatModel = "medium";


  if (!activeChatId) {
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
      lastMessageDate: new Date(),
    });
    activeChatId = chatResult.insertedId.toString();
  } else {
    // Get Chat Model Config & Verify Ownership
    const chat = await db.collection("chats").findOne({ 
      _id: new ObjectId(activeChatId.toString()),
      userId: auth.principal 
    });
    
    if (!chat) {
       res.status(404).json({ error: "Chat not found or access denied" });
       return;
    }
    chatModel = chat.model || "medium";
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
    raw: { role: "user", content: lastMessage.content }
  });

  // Setup tools
  const resources = defaultResourceManager.listResources().filter(resource => RESOURCES_FOR_AI.includes(resource.code));
  const tools = createAiSdkToolsFromResources(resources, auth);

  // Fetch System Prompt
  let systemPrompt = "You are Mycelia, an intelligent AI assistant. You have access to various tools to help the user. Use them when necessary.";

  // throw new Error("Not implemented 112");
  const config = await getServerConfig();
  try {

    if (config.prompts.chat_system) {
        const promptDoc = await db.collection("prompts").findOne({ _id: config.prompts.chat_system });
        if (promptDoc && promptDoc.text) {
            systemPrompt = promptDoc.text;
        }
    }
  } catch (e) {
      console.warn("Failed to load system prompt from config, using default.", e);
  }

  const inference = config.inference;
  if (!inference?.baseUrl || !inference?.apiKey) {
    res.status(500).json({ error: "Inference provider not configured. Please configure it in server settings." });
    return;
  }

  try {
    const stream = streamText({
      model: createOpenAI({
        baseURL: inference.baseUrl,
        apiKey: inference.apiKey,
      }).chat(chatModel),
      tools,
      stopWhen: stepCountIs(5),
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ] as any,
      onError: (errorEvent: any) => {
        const error = errorEvent?.error;
        console.error("[apiChatHandler] Stream error:", error?.message || error);
      },
      async onStepFinish(result) {
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
                lastMessageDate: new Date()
              } 
            }
        );
      },
    });

    // Pipe the stream to the Express response with Chat ID header
    res.setHeader("X-Mycelia-Chat-Id", activeChatId!);
    stream.pipeUIMessageStreamToResponse(res);
  } catch (error) {
    console.error("[apiChatHandler] Chat error:", error);
    // If headers sent, we can't send json
    if (!res.headersSent) {
        res.status(500).json({ error: "Failed to process chat request" });
    }
    
  }
}
