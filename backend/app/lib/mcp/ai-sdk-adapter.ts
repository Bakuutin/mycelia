import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { z } from "zod";
import { tool, Tool, jsonSchema } from "ai";
import { EJSON } from "bson";

const MAX_RESULT_LENGTH = 25000;

function serializeResult(result: unknown): { type: "json" | "text"; value: unknown } {
  const serialized = EJSON.stringify(result);
  if (serialized.length <= MAX_RESULT_LENGTH) {
    return { type: "json", value: JSON.parse(serialized) };
  }
  const trimmed = serialized.slice(0, MAX_RESULT_LENGTH);
  return { type: "text", value: `${trimmed}... [trimmed, total ${serialized.length} characters]` };
}

export interface ToolAdapterOptions {
  /** Tool names that require user approval before execution */
  toolsRequiringApproval?: string[];
}

function zodSchemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // If the top-level schema has a custom toJSONSchema, use it directly
  if ((schema as any)._zod?.toJSONSchema) {
    return (schema as any)._zod.toJSONSchema();
  }
  
  // Use override to handle nested custom types (like zObjectId, zDateOrString)
  // that have their own toJSONSchema methods
  return z.toJSONSchema(schema, {
    unrepresentable: "any",
    override: (ctx) => {
      const zodSchema = ctx.zodSchema as any;
      // Check if this nested schema has a custom toJSONSchema method
      if (zodSchema._zod?.toJSONSchema) {
        return zodSchema._zod.toJSONSchema();
      }
      // Return undefined to use default behavior
      return undefined;
    },
  }) as Record<string, unknown>;
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

export function resourceToTools<Input, Output>(
  resource: Resource<Input, Output>,
  auth: Auth,
  options?: ToolAdapterOptions
): Record<string, { description?: string, inputSchema: any, execute: (args: any) => Promise<any>, needsApproval?: boolean }> {
  const toolsRequiringApproval = new Set(options?.toolsRequiringApproval ?? []);
  const schema = resource.schemas.request;
  const def = schema.def as any;
  const tools: Record<string, { description?: string, inputSchema: any, execute: (args: any) => Promise<any>, needsApproval?: boolean }> = {};

  if ((def?.type === "union")) {
    const discriminator = def.discriminator;
    const options = def.optionsMap ? Array.from(def.optionsMap.values()) : def.options;
    
    for (const optionSchema of options as z.ZodObject<any>[]) {
      const shape = optionSchema.shape;

      if (shape && shape[discriminator]) {
        const discriminatorField = shape[discriminator];
        const actionDef = discriminatorField.def;

        if (actionDef?.values?.length !== 1) {
          throw new Error(`Expected 1 value for discriminator ${discriminator}, got ${JSON.stringify(actionDef)}`);
        } 
        const actionValue = actionDef?.values?.[0];

        if (actionValue) {
          const toolName = `${resource.code.replace(/\./g, "_")}_${actionValue}`;
          const actionDescription = extractActionDescription(optionSchema, actionValue);
          
          let inputSchema = optionSchema;
          if (inputSchema instanceof z.ZodObject) {
             inputSchema = inputSchema.omit({ [discriminator]: true });
          } else {
             if ((inputSchema as any).omit) {
                inputSchema = (inputSchema as any).omit({ [discriminator]: true });
             }
          }

          tools[toolName] = {
            description: actionDescription || resource.description || actionValue,
            inputSchema: inputSchema,
            needsApproval: toolsRequiringApproval.has(toolName),
            execute: async (args: any) => {
              const rawInput = {
                ...args,
                [discriminator]: actionValue,
              };
              // Parse through schema to apply Zod transforms (e.g., string → Date)
              const input = resource.schemas.request.parse(rawInput);
              const result = await resource.use(input as any, auth);
              // Return in AI SDK outputSchema format with EJSON serialization for ObjectIds
              return serializeResult(result);
            },
          };
        }
      }
    }

    if (Object.keys(tools).length > 0) {
      return tools;
    }
  }

  tools[resource.code] = {
    description: resource.description,
    inputSchema: schema,
    needsApproval: toolsRequiringApproval.has(resource.code),
    execute: async (args: any) => {
      // Parse through schema to apply Zod transforms (e.g., string → Date)
      const input = resource.schemas.request.parse(args);
      const result = await resource.use(input, auth);
      // Return in AI SDK outputSchema format with EJSON serialization for ObjectIds
      return serializeResult(result);
    },
  };
  return tools;
}

export function createMCPToolsFromResources(
  resources: Resource<any, any>[],
  auth: Auth,
  options?: ToolAdapterOptions
): Record<string, { description?: string, inputSchema: any, execute: (args: any) => Promise<any>, needsApproval?: boolean }> {
  let allTools: Record<string, { description?: string, inputSchema: any, execute: (args: any) => Promise<any>, needsApproval?: boolean }> = {};
  for (const resource of resources) {
    const resourceTools = resourceToTools(resource, auth, options);
    allTools = { ...allTools, ...resourceTools };
  }
  return allTools;
}

export function createAiSdkToolsFromResources(
  resources: Resource<any, any>[],
  auth: Auth,
  options?: ToolAdapterOptions
): Record<string, Tool> {
  const tools = createMCPToolsFromResources(resources, auth, options);
  const aiSdkTools: Record<string, Tool> = {};
  for (const [name, params] of Object.entries(tools)) {
    try {
      const jsonSchemaObj = zodSchemaToJsonSchema(params.inputSchema);
      aiSdkTools[name] = tool({
        description: params.description,
        inputSchema: jsonSchema(jsonSchemaObj as any),
        needsApproval: params.needsApproval ?? false,
        execute: params.execute,
      });
    } catch (err) {
      console.warn(`[ai-sdk-adapter] Failed to create tool ${name}:`, (err as Error).message);
    }
  }
  return aiSdkTools;
}

export function resourceToAiSdkTools<Input, Output>(
  resource: Resource<Input, Output>,
  auth: Auth,
  options?: ToolAdapterOptions
): Record<string, Tool> {
  const tools = resourceToTools(resource, auth, options);
  const aiSdkTools: Record<string, Tool> = {};
  for (const [name, params] of Object.entries(tools)) {
    try {
      const jsonSchemaObj = zodSchemaToJsonSchema(params.inputSchema);
      aiSdkTools[name] = tool({
        description: params.description,
        inputSchema: jsonSchema(jsonSchemaObj as any),
        needsApproval: params.needsApproval ?? false,
        execute: params.execute,
      });
    } catch (err) {
      console.warn(`[ai-sdk-adapter] Failed to create tool ${name}:`, (err as Error).message);
    }
  }
  return aiSdkTools;
}

