import { type Db, ObjectId } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const CHAT_ARCHIVE_LIST_INDEX = "chats_user_platform_archive_recent_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "chats",
    {
      userId: 1,
      platform: 1,
      archivedAt: 1,
      lastMessageDate: -1,
      _id: -1,
    },
    {
      name: CHAT_ARCHIVE_LIST_INDEX,
      partialFilterExpression: {
        userId: { $type: "string" },
        platform: "mycelia",
      },
    },
  );

  const chats = db.collection("chats");
  const messages = db.collection("messages");
  let afterId: ObjectId | undefined;

  while (true) {
    const batch = await chats.find({
      platform: "mycelia",
      ...(afterId ? { _id: { $gt: afterId } } : {}),
    }, { projection: { _id: 1 } })
      .sort({ _id: 1 })
      .limit(100)
      .toArray();
    if (batch.length === 0) break;

    const operations = [];
    for (const chat of batch) {
      const pinnedMessageCount = await messages.countDocuments({
        chatId: chat._id,
        pinnedAt: { $type: "date" },
      });
      operations.push({
        updateOne: {
          filter: { _id: chat._id },
          update: { $set: { pinnedMessageCount } },
        },
      });
    }
    if (operations.length > 0) await chats.bulkWrite(operations);
    afterId = batch[batch.length - 1]._id;
  }
}

export async function down(db: Db): Promise<void> {
  if (await db.collection("chats").indexExists(CHAT_ARCHIVE_LIST_INDEX)) {
    await db.collection("chats").dropIndex(CHAT_ARCHIVE_LIST_INDEX);
  }
}
