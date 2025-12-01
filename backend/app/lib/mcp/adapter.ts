import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

interface MCPToolMetadata {
  resource: Resource<any, any>;
  action?: string;
}

const toolMetadataMap = new Map<string, MCPToolMetadata>();

function buildMCPInputSchema(schema: any, excludeFields?: string[]): Tool["inputSchema"] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;

  if (json && typeof json === "object" && (json as any).type === "object") {
    if (excludeFields && excludeFields.length > 0) {
      const properties = { ...(json as any).properties };
      const required = [...((json as any).required || [])];

      for (const field of excludeFields) {
        delete properties[field];
        const reqIndex = required.indexOf(field);
        if (reqIndex > -1) {
          required.splice(reqIndex, 1);
        }
      }

      return {
        ...json,
        properties,
        required,
      } as unknown as Tool["inputSchema"];
    }

    return json as unknown as Tool["inputSchema"];
  }
  return { type: "object" } as Tool["inputSchema"];
}

function extractActionDescription(schema: any, actionValue: string): string | undefined {
  const def = schema._def || schema.def;
  if (def?.type === "object") {
    const shape = def.shape;
    const actionField = shape?.action;
    if (actionField) {
      const actionDef = actionField._def || actionField.def;
      if (actionDef?.type === "literal" && actionDef.values?.[0] === actionValue) {
        return actionDef.description || actionField.description;
      }
    }
  }
  return undefined;
}

export function resourceToMCPTools<Input, Output>(
  resource: Resource<Input, Output>,
): Tool[] {
  const schema = resource.schemas.request;
  const def = schema._def as any;

  if (def?.type === "union" && def?.discriminator && def?.options) {
    const discriminator = def.discriminator;
    const options = def.options;
    const tools: Tool[] = [];

    for (const optionSchema of options) {
      const optionDef = optionSchema._def || optionSchema.def;
      const shape = optionDef?.shape;

      if (shape && shape[discriminator]) {
        const discriminatorField = shape[discriminator];
        const actionDef = discriminatorField._def || discriminatorField.def;
        const actionValue = actionDef?.values?.[0];

        if (actionValue) {
          const toolName = `${resource.code}.${actionValue}`;
          const actionDescription = extractActionDescription(optionSchema, actionValue);

          toolMetadataMap.set(toolName, {
            resource,
            action: actionValue,
          });

          tools.push({
            name: toolName,
            description: actionDescription || actionValue,
            inputSchema: buildMCPInputSchema(optionSchema, [discriminator]),
          });
        }
      }
    }

    if (tools.length > 0) {
      return tools;
    }
  }

  toolMetadataMap.set(resource.code, { resource });

  return [{
    name: resource.code,
    description: resource.description,
    inputSchema: buildMCPInputSchema(schema),
  }];
}

export async function handleMCPToolCall(
  toolName: string,
  auth: Auth,
  args: unknown,
): Promise<CallToolResult> {
  const metadata = toolMetadataMap.get(toolName);

  if (!metadata) {
    return {
      content: [{
        type: "text",
        text: `Error: Tool '${toolName}' not found`,
      }],
      isError: true,
    };
  }

  try {
    let input = args;

    if (metadata.action) {
      input = {
        ...args as any,
        action: metadata.action,
      };
    }

    const parsedInput = metadata.resource.schemas.request.parse(input);
    const result = await metadata.resource.use(parsedInput, auth);

    return {
      content: [],
      structuredContent: result,
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
  toolMetadataMap.clear();
  return resources.flatMap(resourceToMCPTools);
}
