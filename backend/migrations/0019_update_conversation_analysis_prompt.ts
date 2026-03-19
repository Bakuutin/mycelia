import type { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import {
  LEGACY_ANALYZE_CONVERSATION_DETAILS_PROMPT,
  STRUCTURED_ANALYZE_CONVERSATION_DETAILS_PROMPT,
} from "@/lib/prompts/conversationExtractor.ts";

const PROMPT_NAME = "Analyze Conversation Details";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  const result = await db.collection("prompts").updateMany(
    {
      name: PROMPT_NAME,
      text: LEGACY_ANALYZE_CONVERSATION_DETAILS_PROMPT,
    },
    {
      $set: {
        text: STRUCTURED_ANALYZE_CONVERSATION_DETAILS_PROMPT,
        updatedAt: new Date(),
      },
    },
  );

  console.log(
    `Updated ${result.modifiedCount} "${PROMPT_NAME}" prompt document(s) to the structured extractor prompt.`,
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  const result = await db.collection("prompts").updateMany(
    {
      name: PROMPT_NAME,
      text: STRUCTURED_ANALYZE_CONVERSATION_DETAILS_PROMPT,
    },
    {
      $set: {
        text: LEGACY_ANALYZE_CONVERSATION_DETAILS_PROMPT,
        updatedAt: new Date(),
      },
    },
  );

  console.log(
    `Reverted ${result.modifiedCount} "${PROMPT_NAME}" prompt document(s) to the legacy text.`,
  );
}
