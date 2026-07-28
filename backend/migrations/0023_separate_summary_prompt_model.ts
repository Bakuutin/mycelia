import { Db, ObjectId } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

/**
 * Prompt templates own instructions only. The summarization worker owns its
 * model route. Preserve the previously effective prompt model when no explicit
 * worker model exists, then remove the legacy coupling.
 */
export const up = async (db: Db) => {
  const config = await db.collection("configs").findOne({
    _id: SERVER_CONFIG_ID,
  });
  const promptId = config?.prompts?.summarization_system;
  const defaultPrompt = promptId
    ? await db.collection("prompts").findOne({ _id: promptId })
    : null;
  const worker = await db.collection("workers").findOne({
    name: "summarization",
  });

  const workerModel = typeof worker?.defaultOverrides?.model === "string"
    ? worker.defaultOverrides.model.trim()
    : "";
  const legacyPromptModel = typeof defaultPrompt?.model === "string"
    ? defaultPrompt.model.trim()
    : "";
  const summaryModel = workerModel || legacyPromptModel || "small";
  const now = new Date();

  await db.collection("workers").updateOne(
    { name: "summarization" },
    {
      $set: {
        "defaultOverrides.model": summaryModel,
        updatedAt: now,
      },
      $unset: {
        "defaultOverrides.prompt": "",
        "defaultOverrides.promptName": "",
      },
    },
    { upsert: false },
  );

  await db.collection("prompts").updateMany(
    { model: { $exists: true } },
    {
      $unset: { model: "" },
      $set: { updatedAt: now },
    },
  );
};

export const down = async () => {
  // The removed prompt/model coupling is intentionally not restored.
};
