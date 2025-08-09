import { expect } from "@std/expect";
import { getMCPServer, handleMCPRequest } from "./mcp.server.ts";
import { Resource, ResourcePath } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { JSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Mock resource for testing
class TestMCPResource implements Resource<{ message: string }, { result: string }> {
  code = "test.mcp";
  description = "Test MCP resource";
  schemas = {
    request: z.object({ message: z.string() }),
    response: z.object({ result: z.string() }),
  };

  async use(input: { message: string }, _auth: Auth): Promise<{ result: string }> {
    return { result: `Echo: ${input.message}` };
  }

  extractActions(_input: { message: string }): { path: ResourcePath; actions: string[] }[] {
    return [{ path: ["test", "message"], actions: ["read"] }];
  }
}

// Mock auth for testing
const mockAuth = new Auth({
  principal: "test-user",
  policies: [],
});

// Mock resource manager
const mockResourceManager = {
  resources: new Map<string, Resource<any, any>>()
};

Deno.test("getMCPServer - creates McpServer instance", () => {
  const testResource = new TestMCPResource();
  mockResourceManager.resources.set(testResource.code, testResource);
  
  const server = getMCPServer(mockAuth, mockResourceManager);
  
  expect(server).toBeDefined();
  expect(typeof server.connect).toBe("function");
  expect(typeof server.close).toBe("function");
  expect(typeof server.isConnected).toBe("function");
});

Deno.test("getMCPServer - registers resources as tools", () => {
  const testResource = new TestMCPResource();
  mockResourceManager.resources.clear();
  mockResourceManager.resources.set(testResource.code, testResource);
  
  const server = getMCPServer(mockAuth, mockResourceManager);
  
  // The tools should be registered internally
  // We can't directly test this without a transport connection,
  // but we can verify the server was created successfully
  expect(server).toBeDefined();
});

Deno.test("getMCPServer - handles empty resource manager", () => {
  const emptyResourceManager = {
    resources: new Map<string, Resource<any, any>>(),
  };
  
  const server = getMCPServer(mockAuth, emptyResourceManager);
  
  expect(server).toBeDefined();
  expect(server.isConnected).toBeDefined();
});

Deno.test("getMCPServer - handles multiple resources", () => {
  class AnotherTestResource implements Resource<{ id: number }, { value: number }> {
    code = "test.another";
    description = "Another test resource";
    schemas = {
      request: z.object({ id: z.number() }),
      response: z.object({ value: z.number() }),
    };

    async use(input: { id: number }, _auth: Auth): Promise<{ value: number }> {
      return { value: input.id * 2 };
    }

    extractActions(_input: { id: number }): { path: ResourcePath; actions: string[] }[] {
      return [{ path: ["test", "another"], actions: ["read"] }];
    }
  }

  const testResource1 = new TestMCPResource();
  const testResource2 = new AnotherTestResource();
  
  mockResourceManager.resources.clear();
  mockResourceManager.resources.set(testResource1.code, testResource1);
  mockResourceManager.resources.set(testResource2.code, testResource2);
  
  const server = getMCPServer(mockAuth, mockResourceManager);
  
  expect(server).toBeDefined();
});

Deno.test("getMCPServer - server has correct properties", () => {
  const server = getMCPServer(mockAuth, { resources: new Map() });
  
  expect(server.server).toBeDefined();
  expect(typeof server.connect).toBe("function");
  expect(typeof server.close).toBe("function");
  expect(typeof server.isConnected).toBe("function");
  expect(typeof server.sendToolListChanged).toBe("function");
});

Deno.test("handleMCPRequest - lists tools", async () => {
  const testResource = new TestMCPResource();
  const resourceManager = {
    resources: new Map<string, Resource<any, any>>(),
  };
  resourceManager.resources.set(testResource.code, testResource);

  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  };

  const response = await handleMCPRequest(resourceManager, mockAuth, request);

  expect(response).toBeDefined();
  expect((response as any).jsonrpc).toBe("2.0");
  expect((response as any).id).toBe(1);
  expect((response as any).result).toBeDefined();
  expect((response as any).result.tools).toBeDefined();
  expect(Array.isArray((response as any).result.tools)).toBe(true);
  expect((response as any).result.tools.length).toBe(1);
  expect((response as any).result.tools[0].name).toBe("test.mcp");
});

Deno.test("handleMCPRequest - calls tool successfully", async () => {
  const testResource = new TestMCPResource();
  const resourceManager = {
    resources: new Map<string, Resource<any, any>>(),
  };
  resourceManager.resources.set(testResource.code, testResource);

  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "test.mcp",
      arguments: { message: "Hello World" },
    },
  };

  const response = await handleMCPRequest(resourceManager, mockAuth, request);

  expect(response).toBeDefined();
  expect((response as any).jsonrpc).toBe("2.0");
  expect((response as any).id).toBe(2);
  expect((response as any).result).toBeDefined();
  expect((response as any).result.content).toBeDefined();
  expect(Array.isArray((response as any).result.content)).toBe(true);
  expect((response as any).result.content[0].type).toBe("text");
  expect((response as any).result.content[0].text).toContain("Echo: Hello World");
});

Deno.test("handleMCPRequest - handles tool not found", async () => {
  const resourceManager = {
    resources: new Map<string, Resource<any, any>>(),
  };

  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "nonexistent.tool",
      arguments: {},
    },
  };

  const response = await handleMCPRequest(resourceManager, mockAuth, request);

  expect(response).toBeDefined();
  expect((response as any).jsonrpc).toBe("2.0");
  expect((response as any).id).toBe(3);
  expect((response as any).error).toBeDefined();
  expect((response as any).error.code).toBe(-32601);
  expect((response as any).error.message).toContain("not found");
});