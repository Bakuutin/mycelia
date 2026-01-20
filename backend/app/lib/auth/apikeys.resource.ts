import { z } from "zod";
import { ObjectId } from "bson";
import { Resource, defaultResourceManager } from "@/lib/auth/resources.ts";
import { type Auth } from "@/lib/auth/core.server.ts";
import { generateApiKeyWithId, listApiKeys, revokeApiKey, updateApiKeyPolicies } from "./tokens.ts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Policy } from "./resources.ts";

const listApiKeysSchema = z.object({
  action: z.literal("list"),
});

const createApiKeySchema = z.object({
  action: z.literal("create"),
  name: z.string().min(1),
  owner: z.string(),
  policiesYaml: z.string(),
});

const revokeApiKeySchema = z.object({
  action: z.literal("revoke"),
  id: z.string(),
  owner: z.string(),
});

const updateApiKeySchema = z.object({
  action: z.literal("update"),
  id: z.string(),
  owner: z.string(),
  policiesYaml: z.string(),
});

const apiKeysRequestSchema = z.discriminatedUnion("action", [
  listApiKeysSchema,
  createApiKeySchema,
  revokeApiKeySchema,
  updateApiKeySchema,
]);

export type ApiKeysRequest = z.infer<typeof apiKeysRequestSchema>;
export type ApiKeysResponse = any;

export class ApiKeysResource
  implements Resource<ApiKeysRequest, ApiKeysResponse> {
  code = "apikeys";
  description = "API key management";
  schemas = {
    request: apiKeysRequestSchema as z.ZodType<ApiKeysRequest>,
    response: z.any(),
  };

  extractActions(input: ApiKeysRequest) {
    return [{
      path: ["apikeys", input.action],
      actions: ["write", "read"],
    }];
  }

  async use(
    input: ApiKeysRequest,
    auth: Auth,
  ): Promise<ApiKeysResponse> {
    if (input.action === "list") {
      const keys = await listApiKeys(auth);
      return keys.map((key) => ({
        _id: key._id,
        name: key.name,
        owner: key.owner,
        openPrefix: key.openPrefix,
        isActive: key.isActive,
        createdAt: key.createdAt,
        policiesYaml: stringifyYaml(key.policies),
      }));
    }

    if (input.action === "create") {
      let policies: Policy[];
      try {
        const parsed = parseYaml(input.policiesYaml);
        policies = Array.isArray(parsed) ? parsed as Policy[] : [];
      } catch (error) {
        throw new Error(
          `Invalid YAML: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }

      const { apiKey, clientId } = await generateApiKeyWithId(
        input.owner,
        input.name,
        policies,
      );

      return {
        apiKey,
        clientId,
        message: "API key created successfully",
      };
    }

    if (input.action === "revoke") {
      const success = await revokeApiKey(input.owner, input.id);
      return {
        success,
        message: success
          ? "API key revoked successfully"
          : "Failed to revoke API key",
      };
    }

    if (input.action === "update") {
      let policies: Policy[];
      try {
        const parsed = parseYaml(input.policiesYaml);
        policies = Array.isArray(parsed) ? parsed as Policy[] : [];
      } catch (error) {
        throw new Error(
          `Invalid YAML: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }

      const success = await updateApiKeyPolicies(
        input.owner,
        input.id,
        policies,
      );
      return {
        success,
        message: success
          ? "API key policies updated successfully"
          : "Failed to update API key policies",
      };
    }

    throw new Error("Invalid action");
  }
}

export async function getApiKeysResource(auth: Auth) {
  return defaultResourceManager.getResource<ApiKeysRequest, ApiKeysResponse>(
    new ApiKeysResource().code,
    auth,
  );
}
