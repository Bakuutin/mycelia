import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { Tool, CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "npm:zod-to-json-schema";

function buildMCPInputSchema(schema: any): Tool["inputSchema"] {
  const json = zodToJsonSchema(schema) as Record<string, unknown>;
  if (json && typeof json === "object" && (json as any).type === "object") {
    return json as unknown as Tool["inputSchema"];
  }
  return { type: "object" } as Tool["inputSchema"];
}

export function resourceToMCPTool<Input, Output>(
  resource: Resource<Input, Output>
): Tool {
  return {
    name: resource.code,
    description: `Resource: ${resource.code}`,
    inputSchema: buildMCPInputSchema(resource.schemas.request),
  };
}

export async function handleResourceToolCall<Input, Output>(
  resource: Resource<Input, Output>,
  auth: Auth,
  args: unknown
): Promise<CallToolResult> {
  try {
    const parsedInput = resource.schemas.request.parse(args);
    const result = await resource.use(parsedInput, auth);
    const textContent: TextContent = {
      type: "text",
      text: JSON.stringify(result, null, 2),
    };
    return {
      content: [textContent],
      isError: false,
    };
  } catch (error) {
    const textContent: TextContent = {
      type: "text", 
      text: `Error: ${(error as Error).message}`,
    };
    return {
      content: [textContent],
      isError: true,
    };
  }
}

export function createMCPToolsFromResources(
  resources: Resource<any, any>[]
): Tool[] {
  return resources.map(resourceToMCPTool);
}