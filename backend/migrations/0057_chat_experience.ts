import { type Db, ObjectId } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const CHAT_LIST_INDEX = "chats_user_platform_recent_v1";
export const CHAT_FAVORITE_INDEX = "chats_user_platform_favorite_recent_v1";
export const CHAT_PINNED_MESSAGES_INDEX = "messages_chat_pinned_v1";
export const CHAT_RUN_ID_INDEX = "chat_runs_user_run_unique_v1";
export const CHAT_RUN_HISTORY_INDEX = "chat_runs_chat_started_v1";
export const CHAT_RUN_STALE_INDEX = "chat_runs_user_state_updated_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "chats",
    { userId: 1, platform: 1, lastMessageDate: -1, _id: -1 },
    {
      name: CHAT_LIST_INDEX,
      partialFilterExpression: {
        userId: { $type: "string" },
        platform: "mycelia",
      },
    },
  );
  await ensureIndexExists(
    db,
    "chats",
    {
      userId: 1,
      platform: 1,
      lastMessageDate: -1,
      _id: -1,
      favoritedAt: 1,
    },
    {
      name: CHAT_FAVORITE_INDEX,
      partialFilterExpression: {
        userId: { $type: "string" },
        platform: "mycelia",
        favoritedAt: { $type: "date" },
      },
    },
  );
  await ensureIndexExists(
    db,
    "messages",
    { chatId: 1, pinnedAt: -1 },
    {
      name: CHAT_PINNED_MESSAGES_INDEX,
      partialFilterExpression: { pinnedAt: { $type: "date" } },
    },
  );
  await ensureIndexExists(
    db,
    "chat_runs",
    { userId: 1, runId: 1 },
    { name: CHAT_RUN_ID_INDEX, unique: true },
  );
  await ensureIndexExists(
    db,
    "chat_runs",
    { chatId: 1, startedAt: -1 },
    { name: CHAT_RUN_HISTORY_INDEX },
  );
  await ensureIndexExists(
    db,
    "chat_runs",
    { userId: 1, state: 1, updatedAt: 1 },
    { name: CHAT_RUN_STALE_INDEX },
  );

  const chats = db.collection("chats");
  const messages = db.collection("messages");
  let afterId: ObjectId | undefined;

  while (true) {
    const batch = await chats.find({
      platform: "mycelia",
      ...(afterId ? { _id: { $gt: afterId } } : {}),
    }, { projection: { _id: 1, name: 1, title: 1, titleSource: 1 } })
      .sort({ _id: 1 })
      .limit(100)
      .toArray();
    if (batch.length === 0) break;

    const operations = [];
    for (const chat of batch) {
      const [messageCount, lastAssistant] = await Promise.all([
        messages.countDocuments({
          chatId: chat._id,
          "raw.role": { $in: ["user", "assistant"] },
        }),
        messages.findOne(
          { chatId: chat._id, "raw.role": "assistant" },
          { sort: { timestamp: -1, createdAt: -1, _id: -1 } },
        ),
      ]);
      const currentTitle = String(chat.title || chat.name || "New Chat");
      operations.push({
        updateOne: {
          filter: { _id: chat._id },
          update: {
            $set: {
              messageCount,
              toolMode: "auto",
              enabledTools: [],
              titleSource: chat.titleSource ||
                (currentTitle === "New Chat" ? "provisional" : "generated"),
              ...(lastAssistant?.raw?.model
                ? { lastResponseModel: lastAssistant.raw.model }
                : {}),
              ...(lastAssistant?.raw?.providerProfileId
                ? {
                  lastResponseProviderId: lastAssistant.raw.providerProfileId,
                }
                : {}),
              ...(lastAssistant?.raw?.providerProfileName
                ? {
                  lastResponseProviderName:
                    lastAssistant.raw.providerProfileName,
                }
                : {}),
            },
          },
        },
      });
    }
    if (operations.length > 0) await chats.bulkWrite(operations);
    afterId = batch[batch.length - 1]._id;
  }
}

export async function down(db: Db): Promise<void> {
  for (
    const [collectionName, indexName] of [
      ["chats", CHAT_LIST_INDEX],
      ["chats", CHAT_FAVORITE_INDEX],
      ["messages", CHAT_PINNED_MESSAGES_INDEX],
      ["chat_runs", CHAT_RUN_ID_INDEX],
      ["chat_runs", CHAT_RUN_HISTORY_INDEX],
      ["chat_runs", CHAT_RUN_STALE_INDEX],
    ] as const
  ) {
    if (await db.collection(collectionName).indexExists(indexName)) {
      await db.collection(collectionName).dropIndex(indexName);
    }
  }
}
