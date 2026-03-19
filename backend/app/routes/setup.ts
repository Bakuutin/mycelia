import type { Request, Response } from "express";
import { Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { generateApiKeyWithId } from "@/lib/auth/tokens.ts";
import type { Policy } from "@/lib/auth/resources.ts";
import { getObjectsResource } from "../lib/objects/resource.server.ts";

async function createPostInstallObjects(auth: Auth) {
    const objects = await getObjectsResource(auth);

    const me = await objects({
      action: "create",
      object: {
        name: "Me",
        isPerson: true,
        icon: { text: "👤" },
        messenger: {
          mycelia: {
            id: auth.principal,
          },
        },
      },
    });

    const mycelia = await objects({
      action: "create",
      object: {
        name: "Mycelia",
        icon: { text: "🍄" },
        messenger: {
          mycelia: {
            id: "system_assistant",
          },
        },
      },
    });

    await objects({
      action: "create",
      object: {
        name: "installed",
        isRelationship: true,
        relationship: {
          subject: me.insertedId.toString(),
          object: mycelia.insertedId.toString(),
          symmetrical: false,
        },
        timeRanges: [{ start: new Date() }],
      },
    });
}
    

export async function setupHandler(req: Request, res: Response) {
  try {
    const createCredentials = req.body?.create === true;

    // Only create credentials when explicitly requested
    if (!createCredentials) {
      res.json({ created: false });
      return;
    }

    // Check if any API keys already exist
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);

    const existingKeys = await mongo({
      action: "find",
      collection: "api_keys",
      query: {},
      options: { limit: 1 },
    });

    if (existingKeys && existingKeys.length > 0) {
      // API keys already exist, refuse to create new ones via web UI
      res.status(400).json({ 
        created: false,
        error: "keys_exist",
        message: "API keys already exist. Generate new keys via CLI.",
      });
      return;
    }

    // No API keys exist, create the first one with root permissions
    const policies: Policy[] = [
      { resource: "**", action: "**", effect: "allow" },
    ];

    const { apiKey, clientId } = await generateApiKeyWithId(
      "admin",
      "default",
      policies,
    );

    console.log("First-run setup: Created initial API key");

    const userAuth = new Auth({
      principal: "admin",
      policies: policies,
    });

    await createPostInstallObjects(userAuth);

    res.json({
      created: true,
      clientId,
      clientSecret: apiKey,
    });
  } catch (error) {
    console.error("Setup error:", error);
    res.status(500).json({
      error: "Failed to run setup",
    });
  }
}

