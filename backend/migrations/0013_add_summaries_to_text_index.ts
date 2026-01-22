import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, client: MongoClient): Promise<void> {
  console.log("Adding summaries to objects text search index...");
  
  // Drop the old text index
  try {
    await db.collection("objects").dropIndex("text_search_index");
    console.log("Dropped old text_search_index");
  } catch (error) {
    console.log("No existing text_search_index to drop (this is fine)");
  }
  
  // Create new text index with summaries included
  await ensureIndexExists(
    db,
    "objects",
    {
      name: "text",
      aliases: "text",
      details: "text",
      "summaries.text": "text",
    },
    { name: "text_search_index" },
  );

  console.log("Successfully created text_search_index with summaries.text included");
}

export async function down(db: Db, client: MongoClient): Promise<void> {
  console.log("Reverting to text search index without summaries...");
  
  // Drop the enhanced text index
  try {
    await db.collection("objects").dropIndex("text_search_index");
    console.log("Dropped enhanced text_search_index");
  } catch (error) {
    console.log("No text_search_index to drop");
  }
  
  // Restore original index without summaries
  await ensureIndexExists(
    db,
    "objects",
    {
      name: "text",
      aliases: "text",
      details: "text",
    },
    { name: "text_search_index" },
  );

  console.log("Restored original text_search_index without summaries");
}
