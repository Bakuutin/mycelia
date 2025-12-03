import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { z } from "zod";
import { tool, Tool } from "ai";

interface AiSdkToolMetadata {
  resource: Resource<any, any>;
  action?: string;
}

const toolMetadataMap = new Map<string, AiSdkToolMetadata>();

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

export function resourceToAiSdkTools<Input, Output>(
  resource: Resource<Input, Output>,
  auth: Auth
): Record<string, Tool> {
  const schema = resource.schemas.request;
  const def = schema._def as any;
  const tools: Record<string, Tool> = {};

  if (def?.type === "discriminatedUnion" && def?.discriminator && def?.options) {
    const discriminator = def.discriminator;
    const options = def.optionsMap ? Array.from(def.optionsMap.values()) : def.options;

    for (const optionSchema of options as z.ZodObject<any>[]) {
      const shape = optionSchema.shape;

      if (shape && shape[discriminator]) {
        const discriminatorField = shape[discriminator];
        // @ts-ignore: Zod internals
        const actionDef = discriminatorField._def || discriminatorField.def;
        const actionValue = actionDef?.value; // For ZodLiteral

        if (actionValue) {
          const toolName = `${resource.code.replace(/\./g, "_")}_${actionValue}`;
          const actionDescription = extractActionDescription(optionSchema, actionValue);
          
          // Create a schema that omits the discriminator
          // We use omit() if it's a ZodObject
          let inputSchema = optionSchema;
          if (inputSchema instanceof z.ZodObject) {
             inputSchema = inputSchema.omit({ [discriminator]: true });
          }

          tools[toolName] = tool({
            description: actionDescription || resource.description || actionValue,
            parameters: inputSchema,
            execute: async (args) => {
              const input = {
                ...args,
                [discriminator]: actionValue,
              };
              return resource.use(input as any, auth);
            },
          });
        }
      }
    }

    if (Object.keys(tools).length > 0) {
      return tools;
    }
  }

  // Default case: single tool for the resource
  tools[resource.code.replace(/\./g, "_")] = tool({
    description: resource.description,
    parameters: schema,
    execute: async (args) => {
      return resource.use(args, auth);
    },
  });

  return tools;
}

export function createAiSdkToolsFromResources(
  resources: Resource<any, any>[],
  auth: Auth
): Record<string, Tool> {
  let allTools: Record<string, Tool> = {};
  
  for (const resource of resources) {
    const resourceTools = resourceToAiSdkTools(resource, auth);
    allTools = { ...allTools, ...resourceTools };
  }
  
  return allTools;
}

