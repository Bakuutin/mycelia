import type { Request, Response } from "express";
import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { authenticateOr401, type Auth } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { createAiSdkToolsFromResources } from "@/lib/mcp/ai-sdk-adapter.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { getOrCreatePersonByMessengerId } from "@/lib/messenger/sdk.server.ts";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

const RESOURCES_FOR_AI = ["search", "objects", "docs", "mongo"];

async function generateChatTitle(
  db: Db,
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
      await db.collection("chats").updateOne(
        { _id: new ObjectId(chatId) },
        { $set: { name: title, title: title } }
      );
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
  const db = await getRootDB();
  
  let { messages, chatId } = req.body;
  
  // Debug: Log incoming messages to understand the structure
  console.log("[apiChatHandler] Incoming messages:", JSON.stringify(messages, null, 2));
  
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
            const errorMessage = part.error?.errmsg || part.error?.message || JSON.stringify(part.error) || "Tool execution failed";
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
        const toolCallIds = new Set(toolCalls.map(tc => tc.toolCallId));
        
        // Only include tool-results that have matching tool-calls in THIS message
        const matchingToolResults = toolResults.filter(tr => toolCallIds.has(tr.toolCallId));
        const orphanedToolResults = toolResults.filter(tr => !toolCallIds.has(tr.toolCallId));
        
        if (orphanedToolResults.length > 0) {
          console.warn(`[apiChatHandler] Dropping ${orphanedToolResults.length} orphaned tool-results without matching tool-calls:`, 
            orphanedToolResults.map(tr => tr.toolCallId));
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
        console.warn("[apiChatHandler] Skipping orphaned tool message from client");
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
  console.log("[apiChatHandler] Normalized messages:", JSON.stringify(messages, null, 2));

  let activeChatId: string | undefined = chatId;
  let chatModel = "medium";
  let isNewChat = false;

  if (!activeChatId) {
    isNewChat = true;
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

  // Setup tools with approval requirements for destructive operations
  const resources = defaultResourceManager.listResources().filter(resource => RESOURCES_FOR_AI.includes(resource.code));
  const tools = createAiSdkToolsFromResources(resources, auth, {
    toolsRequiringApproval: TOOLS_REQUIRING_APPROVAL,
  });

  // Fetch System Prompt
  let systemPrompt = "You are Mycelia, an intelligent AI assistant.";

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

  // Get inference provider using stateless env vars first, MongoDB fallback
  const llmResource = new LLMResource();
  const inference = await llmResource.getInferenceProvider();
  if (!inference?.baseUrl || !inference?.apiKey) {
    res.status(500).json({ error: "Inference provider not configured. Please configure it in server settings." });
    return;
  }

  // Use model from inference provider (env var), fallback to DB model or default
  const actualModel = inference.model || chatModel || "gpt-4o-mini";

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
              void generateChatTitle(db, activeChatId!, userContent.trim(), auth);
            }
          }
        }
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
