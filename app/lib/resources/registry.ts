import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { config } from "@/config.ts";

export async function setupResources(): Promise<void> {
  for (const entry of config.resources) {
    defaultResourceManager.registerResource(entry);    
  }
}
