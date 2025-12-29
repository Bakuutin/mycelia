import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getServerAuth } from "./core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { generateApiKeyWithId } from "./tokens.ts";
import { Policy } from "./resources.ts";

const ENV_FILE_PATH = join(Deno.cwd(), ".env");

/**
 * Auto-initialize API credentials on first run.
 * Creates a default admin API key if none exist and updates .env file.
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

    console.log("[AutoInit] Default API key created successfully");

    // Update .env file with the new credentials
    updateEnvFile(apiKey, clientId);

    console.log("[AutoInit] ✅ Credentials auto-configured:");
    console.log(`  MYCELIA_TOKEN=${apiKey}`);
    console.log(`  MYCELIA_CLIENT_ID=${clientId}`);
    console.log("[AutoInit] These values have been written to .env file");
  } catch (error) {
    console.error("[AutoInit] Failed to auto-initialize credentials:", error);
    // Don't throw - this shouldn't prevent server from starting
  }
}

function updateEnvFile(token: string, clientId: string): void {
  try {
    let envContent = "";

    if (existsSync(ENV_FILE_PATH)) {
      envContent = readFileSync(ENV_FILE_PATH, "utf-8");
    }

    // Replace or add MYCELIA_TOKEN
    if (envContent.includes("MYCELIA_TOKEN=")) {
      envContent = envContent.replace(
        /MYCELIA_TOKEN=.*/,
        `MYCELIA_TOKEN=${token}`,
      );
    } else {
      envContent += `\nMYCELIA_TOKEN=${token}`;
    }

    // Replace or add MYCELIA_CLIENT_ID
    if (envContent.includes("MYCELIA_CLIENT_ID=")) {
      envContent = envContent.replace(
        /MYCELIA_CLIENT_ID=.*/,
        `MYCELIA_CLIENT_ID=${clientId}`,
      );
    } else {
      envContent += `\nMYCELIA_CLIENT_ID=${clientId}`;
    }

    writeFileSync(ENV_FILE_PATH, envContent);
    console.log(`[AutoInit] Updated ${ENV_FILE_PATH}`);
  } catch (error) {
    console.error("[AutoInit] Failed to update .env file:", error);
    console.log("[AutoInit] Please manually add these to your .env file:");
    console.log(`  MYCELIA_TOKEN=${token}`);
    console.log(`  MYCELIA_CLIENT_ID=${clientId}`);
  }
}
