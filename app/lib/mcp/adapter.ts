import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

function buildMCPInputSchema(schema: any): Tool["inputSchema"] {
  const json = zodToJsonSchema(schema) as Record<string, unknown>;
  if (json && typeof json === "object" && (json as any).type === "object") {
    return json as unknown as Tool["inputSchema"];
  }
  return { type: "object" } as Tool["inputSchema"];
}

export function resourceToMCPTool<Input, Output>(
  resource: Resource<Input, Output>,
): Tool {
  return {
    name: resource.code,
    description: resource.description,
    inputSchema: buildMCPInputSchema(resource.schemas.request),
    outputSchema: buildMCPInputSchema(resource.schemas.response),
  };
}

export async function handleResourceToolCall<Input, Output>(
  resource: Resource<Input, Output>,
  auth: Auth,
  args: unknown,
): Promise<CallToolResult> {
  try {
    const parsedInput = resource.schemas.request.parse(args);
    const result = await resource.use(parsedInput, auth);
    return {
      content: [],
      structuredContent: result as any,
      isError: false,
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${(error as Error).message}`,
      }],
      isError: true,
    };
  }
}

export function createMCPToolsFromResources(
  resources: Resource<any, any>[],
): Tool[] {
  return resources.map(resourceToMCPTool);
}
