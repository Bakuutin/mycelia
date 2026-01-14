import { getServerAuth } from "@/lib/auth/core.server.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { ServerConfig, zServerConfig } from "@myceliasdk/config.ts";
import { ObjectId } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

export async function getServerConfig(): Promise<ServerConfig> {
  const auth = await getServerAuth();
  const mongoResource = defaultResourceManager.getResource("mongo", auth);
  const configDoc = await mongoResource({
    action: "findOne",
    collection: "configs",
    query: { _id: SERVER_CONFIG_ID },
  });
  try {
    return zServerConfig.parse(configDoc);
  } catch (error) {
    throw Error("Error parsing server config");
  }
}
