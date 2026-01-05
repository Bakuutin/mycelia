import { Db, ObjectId } from "mongodb";
import { zServerConfig } from "@interfaces/config.ts";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

export const up = async (db: Db) => {
  console.log("Adding inference provider configuration to server config...");

  const configsCollection = db.collection("configs");
  const serverConfig = await configsCollection.findOne({
    _id: SERVER_CONFIG_ID,
  });

  if (!serverConfig) {
    console.log("Server config not found, skipping inference provider migration");
    return;
  }

  if (serverConfig.inference) {
    console.log("Inference provider already configured, skipping");
    return;
  }

  await configsCollection.updateOne(
    { _id: SERVER_CONFIG_ID },
    {
      $set: {
        inference: {
          baseUrl: "https://inference.mycelia.tech",
          apiKey: "",
        },
        updatedAt: new Date(),
      },
    },
  );

  console.log("Added inference provider configuration to server config");
};

export const down = async () => {
  //  noop
};


