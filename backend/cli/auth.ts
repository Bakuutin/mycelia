import { getJWT } from "./utils.ts";
import { CliConfig } from "./config.ts";

export async function handleLogin(config: CliConfig): Promise<void> {
  const accessToken = await getJWT(config);
  if (accessToken) {
    console.log("OAuth authentication successful");
  }
}
