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
  const def = schema.def as any;
  const tools: Record<string, Tool> = {};

  if ((def?.type === "discriminatedUnion" || def?.type === "union") && def?.discriminator && def?.options) {
    const discriminator = def.discriminator;
    const options = def.optionsMap ? Array.from(def.optionsMap.values()) : def.options;
    console.log("Found discriminated union. Discriminator:", discriminator);
    console.log("Options length:", options.length);

    for (const optionSchema of options as z.ZodObject<any>[]) {
      const shape = optionSchema.shape;
      console.log("Checking option shape for discriminator:", discriminator);

      if (shape && shape[discriminator]) {
        const discriminatorField = shape[discriminator];
        const actionDef = discriminatorField._def || discriminatorField.def;
        const actionValue = actionDef?.value; // For ZodLiteral
        console.log("Action value:", actionValue);

        if (actionValue) {
          const toolName = `${resource.code.replace(/\./g, "_")}_${actionValue}`;
          const actionDescription = extractActionDescription(optionSchema, actionValue);
          
          // Create a schema that omits the discriminator
          // We use omit() if it's a ZodObject
          let inputSchema = optionSchema;
          if (inputSchema instanceof z.ZodObject) {
             inputSchema = inputSchema.omit({ [discriminator]: true });
          } else {
             // Check if it is a ZodObject but maybe via internal property
             // In Zod v4 or cross-version, instanceof might fail
             if ((inputSchema as any).omit) {
                inputSchema = (inputSchema as any).omit({ [discriminator]: true });
             }
          }

          tools[toolName] = tool({
            description: actionDescription || resource.description || actionValue,
            parameters: inputSchema,
            execute: async (args: any) => {
              const input = {
                ...args,
                [discriminator]: actionValue,
              };
              return resource.use(input as any, auth);
            },
          } as any);
        }
      }
    }

    if (Object.keys(tools).length > 0) {
      return tools;
    }
  }

  // Default case: single tool for the resource
  tools[resource.code] = tool({
    description: resource.description,
    parameters: schema,
    execute: async (args: any) => {
      return resource.use(args, auth);
    },
  } as any);

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

