import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { Tool, CallToolResult, JSONRPCRequest, JSONRPCResponse, TextContent } from "npm:@modelcontextprotocol/sdk/types.js";
import { resourceToMCPTool, handleResourceToolCall } from "./adapter.ts";

// Server interface for MCP
export interface MCPServer {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args?: Record<string, any>): Promise<CallToolResult>;
  handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse>;
  handleHTTPRequest(httpRequest: Request): Promise<Response>;
}

export class MyceliaResourceMCPServer implements MCPServer {
  private resources: Map<string, Resource<any, any>>;
  
  constructor(
    resources: Resource<any, any>[],
    private auth: Auth,
  ) {
    this.resources = new Map();
    for (const resource of resources) {
      this.resources.set(resource.code, resource);
    }
  }

  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    
    for (const resource of this.resources.values()) {
      tools.push(resourceToMCPTool(resource));
    }
    
    return tools;
  }

  async callTool(name: string, args?: Record<string, any>): Promise<CallToolResult> {
    const resource = this.resources.get(name);
    
    if (!resource) {
      const textContent: TextContent = {
        type: "text",
        text: `Tool '${name}' not found`,
      };
      return {
        content: [textContent],
        isError: true,
      };
    }
    
    return handleResourceToolCall(resource, this.auth, args);
  }

  // JSON-RPC 2.0 request handler
  async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    try {
      let result: any;
      
      switch (request.method) {
        case "tools/list":
          result = await this.listTools();
          break;
          
        case "tools/call":
          if (!request.params?.name) {
            throw new Error("Tool name is required");
          }
          result = await this.callTool(
            request.params.name,
            request.params.arguments || {}
          );
          break;
          
        default:
          throw new Error(`Unknown method: ${request.method}`);
      }
      
      return {
        jsonrpc: "2.0",
        id: request.id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: "2.0", 
        id: request.id,
        error: {
          code: -32603, // Internal error
          message: error.message,
        },
      };
    }
  }
  
  // HTTP handler for MCP over HTTP
  async handleHTTPRequest(httpRequest: Request): Promise<Response> {
    if (httpRequest.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    
    try {
      const mcpRequest: JSONRPCRequest = await httpRequest.json();
      const mcpResponse = await this.handleRequest(mcpRequest);
      
      return new Response(JSON.stringify(mcpResponse), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700, // Parse error
          message: "Invalid JSON",
        },
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }
}

// Factory function to create MCP server from resource manager
export function createMCPServerFromResourceManager(
  resourceManager: { resources: Map<string, Resource<any, any>> },
  auth: Auth,
): MyceliaResourceMCPServer {
  const resources = Array.from(resourceManager.resources.values());
  return new MyceliaResourceMCPServer(resources, auth);
}

// Utility to create MCP server for CLI/direct usage
export async function createMCPServerWithAuth(
  resourceManager: { resources: Map<string, Resource<any, any>> },
  principal = "admin",
): Promise<MyceliaResourceMCPServer> {
  const auth = new Auth({
    principal,
    policies: [{
      action: "*",
      resource: "**", 
      effect: "allow",
    }],
  });
  
  return createMCPServerFromResourceManager(resourceManager, auth);
}