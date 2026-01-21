import type { Request, Response } from "express";
import { Auth } from "@/lib/auth/core.server.ts";
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

    // Create a new API key with root permissions
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

