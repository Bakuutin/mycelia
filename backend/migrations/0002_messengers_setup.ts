import { Db } from "mongodb";

export const up = async (db: Db) => {
  const BATCH_SIZE = 1000;

  // 1. Update existing chats (Mycelia native chats)
  // Assuming existing chats don't have 'platform' field yet, set it to 'mycelia'
  // and set externalId to their _id string representation
  console.log("Starting chats migration...");
  const chatsCursor = db.collection("chats").find({ platform: { $exists: false } });
  
  let chatOps: any[] = [];
  let chatsCount = 0;

  while (await chatsCursor.hasNext()) {
    const chat = await chatsCursor.next();
    if (chat) {
      chatOps.push({
        updateOne: {
          filter: { _id: chat._id },
          update: {
            $set: {
              platform: "mycelia",
              externalId: chat._id.toString(), // Mycelia native IDs are ObjectIds
              type: "private", // Default type
            }
          }
        }
      });
      chatsCount++;

      if (chatOps.length >= BATCH_SIZE) {
        await db.collection("chats").bulkWrite(chatOps);
        chatOps = [];
        console.log(`Processed ${chatsCount} chats`);
      }
    }
  }

  if (chatOps.length > 0) {
    await db.collection("chats").bulkWrite(chatOps);
    console.log(`Processed ${chatsCount} chats (finished)`);
  }

  // 2. Update existing messages (Mycelia native messages)
  // Set platform to 'mycelia' and externalId to _id string
  console.log("Starting messages migration...");
  const messagesCursor = db.collection("messages").find({ platform: { $exists: false } });
  
  let messageOps: any[] = [];
  let messagesCount = 0;
  
  while (await messagesCursor.hasNext()) {
    const msg = await messagesCursor.next();
    if (msg) {
      messageOps.push({
        updateOne: {
          filter: { _id: msg._id },
          update: {
            $set: {
              platform: "mycelia",
              externalId: msg._id.toString(),
            }
          }
        }
      });
      messagesCount++;

      if (messageOps.length >= BATCH_SIZE) {
        await db.collection("messages").bulkWrite(messageOps);
        messageOps = [];
        console.log(`Processed ${messagesCount} messages`);
      }
    }
  }

  if (messageOps.length > 0) {
    await db.collection("messages").bulkWrite(messageOps);
    console.log(`Processed ${messagesCount} messages (finished)`);
  }

  // 3. Create Indexes
  console.log("Creating indexes...");
  const chats = db.collection("chats");
  const messages = db.collection("messages");

  // Chats Indexes
  await chats.createIndex(
    { platform: 1, externalId: 1 },
    { name: "platform_external_id_unique", unique: true }
  );
  await chats.createIndex(
    { lastMessageDate: -1 },
    { name: "last_message_date_sort" }
  );

  await messages.createIndex(
    { platform: 1, chatId: 1, externalId: 1 },
    { name: "platform_chat_message_unique", unique: true }
  );
  
  await messages.createIndex(
    { chatId: 1, timestamp: -1 },
    { name: "chat_history" }
  );
  
  await messages.createIndex(
    { senderId: 1, timestamp: -1 },
    { name: "sender_history" }
  );
  console.log("Migration completed.");
};

export const down = async (db: Db) => {
  // Remove indexes
  try {
    await db.collection("chats").dropIndex("platform_external_id_unique");
    await db.collection("chats").dropIndex("last_message_date_sort");
    await db.collection("messages").dropIndex("platform_chat_message_unique");
    await db.collection("messages").dropIndex("chat_history");
    await db.collection("messages").dropIndex("sender_history");
  } catch (e) {
    console.warn("Migration down: Failed to drop some indexes", e);
  }

  // We typically don't revert data changes (removing fields) in down migrations for this kind of evolution
  // to avoid data loss if we rollback after new data is added.
};
