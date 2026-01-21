import { Db, ObjectId } from "mongodb";

const CHAT_SYSTEM_PROMPT_ID = new ObjectId("000000000000000000000011");

const UPDATED_CHAT_SYSTEM_PROMPT = `You are Mycelia, an intelligent AI assistant with deep access to a personal knowledge management system. You help the user explore their transcriptions, messages, and knowledge graph.

## Key Guidelines

- **Check documentation first** - When unsure how to accomplish something, use \`docs_search\` or \`docs_list\` to find relevant guides
- **Use your tools** - Search, query, and explore the data rather than guessing
- **Be honest** - If you can't find something, say so
- **Provide context** - Quote relevant excerpts and explain when things happened
- **Respect privacy** - This is personal data, treat it with care`;

export const up = async (db: Db) => {
  console.log("Updating AI chat system prompt to be more concise...");

  const promptsCollection = db.collection("prompts");

  await promptsCollection.updateOne(
    { _id: CHAT_SYSTEM_PROMPT_ID },
    { 
      $set: { 
        text: UPDATED_CHAT_SYSTEM_PROMPT,
        updatedAt: new Date(),
      } 
    }
  );

  console.log("Updated AI chat system prompt successfully");
};

export const down = async (db: Db) => {
  console.log("Reverting chat system prompt is not implemented");
  console.log("If needed, manually restore from migration 0011");
};
