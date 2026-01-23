import { Db, ObjectId } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");
const NEW_PROMPT_NAME = "2-3 Paragraph Summary";

export const up = async (db: Db) => {
  console.log("Changing default summarization prompt to 2-3 Paragraph Summary...");

  const promptsCollection = db.collection("prompts");
  const configsCollection = db.collection("configs");

  let prompt = await promptsCollection.findOne({ name: NEW_PROMPT_NAME });

  if (!prompt) {
    const result = await promptsCollection.insertOne({
      name: NEW_PROMPT_NAME,
      description: "Generate a concise 2-3 paragraph summary of the conversation",
      text: `Provide a brief 2-3 paragraph summary of the main topics discussed in this conversation. Focus on the key things mentioned. Be concise and clear.`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prompt = { _id: result.insertedId };
    console.log(`Created prompt: ${NEW_PROMPT_NAME}`);
  } else {
    console.log(`Prompt already exists: ${NEW_PROMPT_NAME}`);
  }

  await configsCollection.updateOne(
    { _id: SERVER_CONFIG_ID },
    {
      $set: {
        "prompts.summarization_system": prompt._id,
        updatedAt: new Date(),
      },
      $unset: {
        "prompts.summarization_guidance": "",
      },
    }
  );

  console.log("Updated server config to use 2-3 Paragraph Summary prompt");
};

export const down = async (db: Db) => {
  console.log("Reverting summarization prompt change is not implemented");
  console.log("Manually restore by setting prompts.summarization_system to the original prompt ID");
};
