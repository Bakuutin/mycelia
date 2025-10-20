import { expect } from "@std/expect";
import { handleMCPRequest } from "./mcp.server.ts";
import {
  Resource,
  ResourceManager,
  ResourcePath,
} from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { JSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Mock resource for testing
class TestMCPResource
  implements Resource<{ message: string }, { result: string }> {
  code = "test.mcp";
  description = "Test MCP resource";
  schemas = {
    request: z.object({ message: z.string() }),
    response: z.object({ result: z.string() }),
  };

  async use(
    input: { message: string },
    _auth: Auth,
  ): Promise<{ result: string }> {
    return { result: `Echo: ${input.message}` };
  }

  extractActions(
    _input: { message: string },
  ): { path: ResourcePath; actions: string[] }[] {
    return [{ path: ["test", "message"], actions: ["read"] }];
  }
}

// Mock auth for testing
const mockAuth = new Auth({
  principal: "test-user",
  policies: [
    {
      effect: "allow",
      resource: "test/message",
      action: "read",
    },
  ],
});

// Mock resource manager
const mockResourceManager = new ResourceManager();

Deno.test("handleMCPRequest - lists tools", async () => {
  const testResource = new TestMCPResource();
  const resourceManager = new ResourceManager();
  resourceManager.registerResource(testResource);

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
  const resourceManager = new ResourceManager();
  resourceManager.registerResource(testResource);

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
  expect((response as any).result.content[0].text).toContain(
    "Echo: Hello World",
  );
});

Deno.test("handleMCPRequest - handles tool not found", async () => {
  const resourceManager = new ResourceManager();

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
