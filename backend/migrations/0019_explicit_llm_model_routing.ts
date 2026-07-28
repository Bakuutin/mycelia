import { Db, ObjectId } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");
const RETIRED_INFERENCE_URL = "https://inference.mycelia.tech";
const LEGACY_GEMINI_SUMMARY_MODEL = "openrouter/google/gemini-2.5-flash";

export const up = async (db: Db) => {
  const configs = db.collection("configs");
  const workers = db.collection("workers");

  // Do not leave new or upgraded installations pointing at the retired hosted
  // endpoint. Preserve any real credential or custom provider configuration.
  await configs.updateOne(
    {
      _id: SERVER_CONFIG_ID,
      "inference.baseUrl": RETIRED_INFERENCE_URL,
      $or: [
        { "inference.apiKey": "" },
        { "inference.apiKey": { $exists: false } },
      ],
    },
    {
      $set: {
        inference: null,
        updatedAt: new Date(),
      },
    },
  );

  await configs.updateOne(
    {
      _id: SERVER_CONFIG_ID,
      inference: { $type: "object" },
      "inference.fallbackEnabled": { $exists: false },
    },
    {
      $set: {
        "inference.fallbackEnabled": false,
        updatedAt: new Date(),
      },
    },
  );

  // This used to be seeded as the summarization primary, not as a real
  // fallback. Remove it so summaries inherit the explicit global model.
  await workers.updateOne(
    {
      name: "summarization",
      "defaultOverrides.model": LEGACY_GEMINI_SUMMARY_MODEL,
    },
    {
      $unset: { "defaultOverrides.model": "" },
      $set: { updatedAt: new Date() },
    },
  );
};

export const down = async () => {
  // Retired provider and implicit model defaults are intentionally not restored.
};
