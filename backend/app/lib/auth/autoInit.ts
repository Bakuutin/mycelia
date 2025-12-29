import { getServerAuth } from "./core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { generateApiKeyWithId } from "./tokens.ts";
import { Policy } from "./resources.ts";

/**
 * Auto-initialize API credentials on first run.
 * Creates a default admin API key if none exist.
 */
export async function autoInitCredentials(): Promise<void> {
  try {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);

    // Check if any API keys exist
    const existingKeys = await mongo({
      action: "find",
      collection: "api_keys",
      query: { isActive: true },
      options: { limit: 1 },
    });

    if (existingKeys && existingKeys.length > 0) {
      console.log("[AutoInit] API keys already exist, skipping auto-initialization");
      return;
    }

    console.log("[AutoInit] No API keys found, creating default admin key...");

    // Create default admin API key with full permissions
    const policies: Policy[] = [
      { resource: "**", action: "**", effect: "allow" },
    ];

    const { apiKey, clientId } = await generateApiKeyWithId(
      "admin",
      "auto_generated_default",
      policies,
    );

    console.log("[AutoInit] ✅ Default API key created. Add to your .env file:");
    console.log(`  MYCELIA_TOKEN=${apiKey}`);
    console.log(`  MYCELIA_CLIENT_ID=${clientId}`);
  } catch (error) {
    console.error("[AutoInit] Failed to auto-initialize credentials:", error);
    // Don't throw - this shouldn't prevent server from starting
  }
}
