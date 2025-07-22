import { getJWT } from "./utils.ts";
import { CliConfig } from "./config.ts";

export async function handleLogin(config: CliConfig): Promise<void> {
  const jwt = await getJWT(config);
  if (jwt) {
    console.log("Authentication successful");
  }
}
