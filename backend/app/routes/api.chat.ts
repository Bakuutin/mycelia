import type { Request, Response } from "express";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import { ObjectId } from "mongodb";

export async function apiChatHandler(req: Request, res: Response) {
  console.log(req.body);
  const auth = await authenticateOr401(req, res);

  // 2. Load or Create Chat Session (Persistence)
  const db = await getRootDB();

  const { messages, chatId } = req.body;
  let activeChatId = chatId;

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
      title: '',
      model: "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    activeChatId = chatResult.insertedId.toString();
  }

  // 3. Get Chat Model Config
  // Retrieve chat to get the assigned model
  const chat = await db.collection("chats").findOne({ _id: new ObjectId(activeChatId) });
  if (!chat) {
     res.status(404).json({ error: "Chat not found" });
     return;
  }
  
  const modelAlias = chat.model || "medium";
  
  const llmResource = new LLMResource();
  const modelConfig = await llmResource.getModel(modelAlias);

  if (!modelConfig) {
    res.status(500).json({ error: `Model '${modelAlias}' not configured` });
    return;
  }

  const lastMessage = messages[messages.length - 1];
  await db.collection("messages").insertOne({
    chatId: new ObjectId(activeChatId),
    role: "user",
    content: lastMessage.content,
    createdAt: new Date(),
  });

  try {
    const result = await streamText({
      model: createOpenAI({
        baseURL: modelConfig.baseUrl,
        apiKey: modelConfig.apiKey,
      }).chat(modelConfig.name), 
      messages,
      async onFinish({ text, usage }) {
        // 6. Save AI Response (Persistence)
        await db.collection("messages").insertOne({
          chatId: new ObjectId(activeChatId),
          role: "assistant",
          content: text,
          usage, 
          createdAt: new Date(),
        });
        
        // Update chat timestamp
        await db.collection("chats").updateOne(
            { _id: new ObjectId(activeChatId) },
            { $set: { updatedAt: new Date() } }
        );
      },
    });

    // Pipe the stream to the Express response
    result.pipeTextStreamToResponse(res);
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to process chat request" });
  }
}

