import { ResourceManager } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  CallToolResult,
  JSONRPCError,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  Resource as MCPResource,
  Prompt,
  GetPromptResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createMCPToolsFromResources } from "./ai-sdk-adapter.ts"
import { EJSON } from "bson";
import { z } from "zod";

// Detect JSON-RPC message type
export type JSONRPCMessageType =
  | "request"
  | "notification"
  | "response"
  | "error";

export function detectJSONRPCMessageType(message: any): JSONRPCMessageType {
  if (typeof message !== "object" || message === null) {
    throw new Error("Invalid JSON-RPC message");
  }

  // Check for response (has result or error and id)
  if (("result" in message || "error" in message) && "id" in message) {
    return message.error ? "error" : "response";
  }

  // Check for request (has method and id)
  if ("method" in message && "id" in message) {
    return "request";
  }

  // Check for notification (has method but no id)
  if ("method" in message && !("id" in message)) {
    return "notification";
  }

  throw new Error("Invalid JSON-RPC message format");
}

// Create InitializeResult
export function createInitializeResult() {
  return {
    protocolVersion: "2025-03-26",
    capabilities: {
      logging: {},
      tools: {},
      resources: {
        subscribe: false,
        listChanged: false,
      },
      prompts: {},
      sampling: {},
    },
    serverInfo: {
      name: "mycelia",
      version: "1.0.0",
    },
  };
}

// HTTP handler for MCP server - handles JSON-RPC requests over HTTP
export async function handleMCPRequest(
  resourceManager: ResourceManager,
  auth: Auth,
  request: JSONRPCRequest,
): Promise<JSONRPCResponse | JSONRPCError> {
  try {
    switch (request.method) {
      case "initialize": {
        // Handle MCP initialize request
        const initResult = createInitializeResult();
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: initResult,
        };
      }

      case "tools/list": {
        const resources = resourceManager.listResources();
        const toolsMap = createMCPToolsFromResources(resources, auth);

        const tools = Object.entries(toolsMap).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: z.toJSONSchema(tool.inputSchema),
        }));

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { tools },
        };
      }

      case "tools/call": {
        const params = request.params as {
          name: string;
          arguments?: Record<string, any>;
        };

        if (!params || !params.name) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: "Invalid params: name is required",
            },
          };
        }

        const resources = resourceManager.listResources();
        const toolsMap = createMCPToolsFromResources(resources, auth);
        const tool = toolsMap[params.name];

        if (!tool) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: `Tool not found: ${params.name}`,
            },
          };
        }

        try {
          const result = await tool.execute(params.arguments || {});

          // Format result for MCP
          // If result is simple string, wrap in text content
          // If result is object, stringify it
          const content = typeof result === "string" 
            ? result 
            : EJSON.stringify(result, { relaxed: true });

          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [
                {
                  type: "text",
                  text: content,
                },
              ],
            },
          };
        } catch (error: any) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32000,
              message: error.message || "Internal error",
              data: error.stack,
            },
          };
        }
      }

      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: "Method not found",
          },
        };
    }
  } catch (error: any) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32603,
        message: "Internal JSON-RPC error",
        data: error.message,
      },
    };
  }
}

export async function handleMCPNotification(
  notification: JSONRPCNotification,
): Promise<void> {
  switch (notification.method) {
    case "notifications/initialized":
      // Client initialized
      break;
    case "notifications/cancelled":
      // Request cancelled
      break;
    default:
      // Unknown notification
      break;
  }
}
