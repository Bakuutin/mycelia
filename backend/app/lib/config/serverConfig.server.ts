import { getServerAuth } from "@/lib/auth/core.server.ts";
import { ServerConfig } from "@myceliasdk/config.ts";
import { getConfigResource } from "./resource.server.ts";

export async function getServerConfig(): Promise<ServerConfig> {
  const auth = await getServerAuth();
  const configResource = await getConfigResource(auth);
  return await configResource({ action: "get" }) as ServerConfig;
}
