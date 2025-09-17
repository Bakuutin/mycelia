import { ResourceManager } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  CallToolResult,
  JSONRPCError,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";
import { createMCPToolsFromResources } from "./adapter.ts";
import { EJSON } from "bson";

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
      resources: {},
      prompts: {},
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
        // List all available tools using proper schemas from adapter
        const resources = resourceManager.listResources();
        console.log(
          `${resources.length} resources found: ${
            resources.map((r) => r.code).join(", ")
          }`,
        );
        const tools = createMCPToolsFromResources(resources);

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { tools },
        };
      }

      case "tools/call": {
        const { name, arguments: args } = request.params as {
          name: string;
          arguments?: Record<string, any>;
        };

        if (!name) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32602,
              message: "Tool name is required",
            },
          } as JSONRPCError;
        }

        const resource = resourceManager.listResources().find((r) =>
          r.code === name
        );
        if (!resource) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: `Tool '${name}' not found`,
            },
          } as JSONRPCError;
        }

        try {
          const run = await resourceManager.getResource(
            name,
            auth,
          );
          try {
            const deserializedArgs = EJSON.deserialize(args ?? {} as any);
            const result = await run(deserializedArgs);

            return {
              jsonrpc: "2.0",
              id: request.id,
              result: {
                content: [{
                  type: "text",
                  text: EJSON.stringify(result),
                }],
                isError: false,
              } as CallToolResult,
            };
          } catch (error) {
            if (error instanceof Response) {
              return {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                  code: -32602,
                  message: "Invalid params",
                },
              } as JSONRPCError;
            }
            throw error;
          }

          
        } catch (error) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [{
                type: "text",
                text: `Error: ${(error as Error).message}`,
              }],
              isError: true,
            } as CallToolResult,
          };
        }
      }

      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Unknown method: ${request.method}`,
          },
        } as JSONRPCError;
    }
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32603,
        message: (error as Error).message,
      },
    } as JSONRPCError;
  }
}

// Handle MCP notifications (no response expected)
export async function handleMCPNotification(
  notification: JSONRPCNotification,
): Promise<void> {
  try {
    switch (notification.method) {
      case "initialized":
        // Client has finished initialization
        console.log("MCP client initialized");
        break;

      case "notifications/message":
        // Handle client notification
        console.log("Client notification:", notification.params);
        break;

      default:
        console.warn(`Unknown notification method: ${notification.method}`);
    }
  } catch (error) {
    console.error("Error handling notification:", error);
  }
}
