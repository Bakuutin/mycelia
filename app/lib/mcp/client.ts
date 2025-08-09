import { Tool, CallToolResult, JSONRPCRequest, JSONRPCResponse } from "npm:@modelcontextprotocol/sdk/types.js";

// Client interface for MCP tools
export interface MCPClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args?: Record<string, any>): Promise<CallToolResult>;
}

export class HTTPMCPClient implements MCPClient {
  constructor(private baseUrl: string) {}

  async connect(): Promise<void> {
    // For HTTP client, connection is per-request
    // Could add health check here
  }

  async disconnect(): Promise<void> {
    // For HTTP client, no persistent connection to close
  }

  private async makeRequest(method: string, params?: Record<string, any>): Promise<any> {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: Math.random().toString(36).substr(2, 9),
      method,
      params,
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const mcpResponse: JSONRPCResponse = await response.json();

    if (mcpResponse.error) {
      throw new Error(`MCP Error ${mcpResponse.error.code}: ${mcpResponse.error.message}`);
    }

    return mcpResponse.result;
  }

  async listTools(): Promise<Tool[]> {
    return this.makeRequest("tools/list");
  }

  async callTool(name: string, args?: Record<string, any>): Promise<CallToolResult> {
    return this.makeRequest("tools/call", { name, arguments: args });
  }
}

// In-process MCP client (for same-process usage)
export class InProcessMCPClient implements MCPClient {
  constructor(private server: { handleRequest(req: JSONRPCRequest): Promise<JSONRPCResponse> }) {}

  async connect(): Promise<void> {
    // No connection needed for in-process
  }

  async disconnect(): Promise<void> {
    // No connection to close
  }

  private async makeRequest(method: string, params?: Record<string, any>): Promise<any> {
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: Math.random().toString(36).substr(2, 9),
      method,
      params,
    };

    const response = await this.server.handleRequest(request);

    if (response.error) {
      throw new Error(`MCP Error ${response.error.code}: ${response.error.message}`);
    }

    return response.result;
  }

  async listTools(): Promise<Tool[]> {
    return this.makeRequest("tools/list");
  }

  async callTool(name: string, args?: Record<string, any>): Promise<CallToolResult> {
    return this.makeRequest("tools/call", { name, arguments: args });
  }
}

// Utility function to create a client
export function createMCPClient(
  serverUrlOrInstance: string | { handleRequest(req: JSONRPCRequest): Promise<JSONRPCResponse> }
): MCPClient {
  if (typeof serverUrlOrInstance === "string") {
    return new HTTPMCPClient(serverUrlOrInstance);
  } else {
    return new InProcessMCPClient(serverUrlOrInstance);
  }
}