import { Db } from "mongodb";

interface Prompt {
  name: string;
  text: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SUMMARIZATION_PROMPTS: Omit<Prompt, 'createdAt' | 'updatedAt'>[] = [
  {
    name: "2-3 Paragraph Summary",
    description: "Generate a concise 2-3 paragraph summary of the conversation",
    text: `Provide a brief 2-3 paragraph summary of the main topics discussed in this conversation. Focus on the key points and outcomes. Be concise and clear.`,
  },
  {  
    name: "Action Items",
    description: "Extract action items and tasks mentioned in the conversation",
    text: `Extract all action items, tasks, and next steps from this conversation. Format as a bulleted list with:
- Clear description of each action item
- Who is responsible (if mentioned)
- Any deadlines or timeframes (if mentioned)

If no action items are present, state "No action items identified."`,
  },
  {
    name: "Key Insights",
    description: "Identify the most important insights and takeaways",
    text: `Identify the 3-5 most important insights or takeaways from this conversation. For each insight:
- State the insight clearly
- Explain why it's significant
- Note any implications or follow-up considerations

Focus on novel ideas, important realizations, or valuable information shared.`,
  },
  {
    name: "Meeting Notes",
    description: "Structured meeting notes format with sections",
    text: `Create structured meeting notes for this conversation using the following format:

**Topics Discussed:**
- [List main topics]

**Key Points:**
- [Important points and details]

**Decisions Made:**
- [Any decisions or conclusions]

**Action Items:**
- [Tasks and next steps]

**Questions/Open Items:**
- [Unresolved questions or items for follow-up]`,
  },
];

export const up = async (db: Db) => {
  console.log("Adding summarization prompts...");

  const promptsCollection = db.collection("prompts");
  const timestamp = new Date();
  let addedCount = 0;
  let skippedCount = 0;

  for (const prompt of SUMMARIZATION_PROMPTS) {
    const existing = await promptsCollection.findOne({ name: prompt.name });

    if (!existing) {
      await promptsCollection.insertOne({
        ...prompt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      console.log(`Added prompt: ${prompt.name}`);
      addedCount++;
    } else {
      console.log(`Skipped existing prompt: ${prompt.name}`);
      skippedCount++;
    }
  }

  console.log(`Migration completed: ${addedCount} prompts added, ${skippedCount} skipped`);
};

export const down = async (db: Db) => {
  // No down migration needed, schema has not changed
};
