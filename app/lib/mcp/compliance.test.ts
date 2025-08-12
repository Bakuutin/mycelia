import { expect } from "@std/expect";
import {
  createInitializeResult,
  detectJSONRPCMessageType,
  handleMCPNotification,
  handleMCPRequest,
} from "./mcp.server.ts";
import { getMCPConfig, validateProtocolVersion } from "./config.ts";
import {
  Resource,
  ResourceManager,
  ResourcePath,
} from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import {
  JSONRPCNotification,
  JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Test resource
class TestComplianceResource
  implements Resource<{ test: string }, { result: string }> {
  code = "test.compliance";
  description = "Test compliance resource";
  schemas = {
    request: z.object({ test: z.string() }),
    response: z.object({ result: z.string() }),
  };

  async use(input: { test: string }, _auth: Auth): Promise<{ result: string }> {
    return { result: `Processed: ${input.test}` };
  }

  extractActions(
    _input: { test: string },
  ): { path: ResourcePath; actions: string[] }[] {
    return [{ path: ["test", "compliance"], actions: ["read"] }];
  }
}

const mockAuth = new Auth({
  principal: "test-compliance-user",
  policies: [
    {
      effect: "allow",
      resource: "test/compliance",
      action: "read",
    },
  ],
});

const mockResourceManager = new ResourceManager();

Deno.test("MCP Compliance - detectJSONRPCMessageType", () => {
  // Request (has method and id)
  expect(detectJSONRPCMessageType({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  })).toBe("request");

  // Notification (has method, no id)
  expect(detectJSONRPCMessageType({
    jsonrpc: "2.0",
    method: "initialized",
  })).toBe("notification");

  // Response (has result and id)
  expect(detectJSONRPCMessageType({
    jsonrpc: "2.0",
    id: 1,
    result: { tools: [] },
  })).toBe("response");

  // Error response (has error and id)
  expect(detectJSONRPCMessageType({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32601, message: "Method not found" },
  })).toBe("error");

  // Invalid message should throw
  expect(() => detectJSONRPCMessageType({})).toThrow();
  expect(() => detectJSONRPCMessageType(null)).toThrow();
});

Deno.test("MCP Compliance - Protocol version validation", () => {
  const config = getMCPConfig();

  expect(validateProtocolVersion("2025-03-26", config)).toBe("2025-03-26");
  expect(validateProtocolVersion("2024-11-05", config)).toBe("2024-11-05");
  expect(validateProtocolVersion(null, config)).toBe("2025-03-26"); // default
  expect(validateProtocolVersion("invalid-version", config)).toBe(null);
});

Deno.test("MCP Compliance - Initialize request", async () => {
  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };

  const response = await handleMCPRequest(
    mockResourceManager,
    mockAuth,
    request,
  );

  expect(response.jsonrpc).toBe("2.0");
  expect(response.id).toBe(1);
  expect((response as any).result).toBeDefined();
  expect((response as any).result.protocolVersion).toBe("2025-03-26");
  expect((response as any).result.capabilities).toBeDefined();
  expect((response as any).result.serverInfo).toBeDefined();
});

Deno.test("MCP Compliance - Tools list with proper schemas", async () => {
  const testResource = new TestComplianceResource();
  const resourceManager = new ResourceManager();
  resourceManager.registerResource(testResource);

  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  };

  const response = await handleMCPRequest(resourceManager, mockAuth, request);

  expect(response.jsonrpc).toBe("2.0");
  expect(response.id).toBe(2);
  expect((response as any).result).toBeDefined();
  expect((response as any).result.tools).toBeDefined();
  expect(Array.isArray((response as any).result.tools)).toBe(true);
  expect((response as any).result.tools.length).toBe(1);

  const tool = (response as any).result.tools[0];
  expect(tool.name).toBe("test.compliance");
  expect(tool.description).toBe("Test compliance resource");
  expect(tool.inputSchema).toBeDefined();
  // Should have proper schema, not stub
  expect(tool.inputSchema.type).toBe("object");
});

Deno.test("MCP Compliance - Tool call", async () => {
  const testResource = new TestComplianceResource();
  const resourceManager = new ResourceManager();
  resourceManager.registerResource(testResource);

  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "test.compliance",
      arguments: { test: "hello world" },
    },
  };

  const response = await handleMCPRequest(resourceManager, mockAuth, request);

  expect(response.jsonrpc).toBe("2.0");
  expect(response.id).toBe(3);
  expect((response as any).result).toBeDefined();
  expect((response as any).result.content).toBeDefined();
  expect((response as any).result.content[0].text).toContain(
    "Processed: hello world",
  );
});

Deno.test("MCP Compliance - Unknown method error", async () => {
  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 4,
    method: "unknown/method",
  };

  const response = await handleMCPRequest(
    mockResourceManager,
    mockAuth,
    request,
  );

  expect(response.jsonrpc).toBe("2.0");
  expect(response.id).toBe(4);
  expect((response as any).error).toBeDefined();
  expect((response as any).error.code).toBe(-32601); // Method not found
});

Deno.test("MCP Compliance - Notification handling", async () => {
  const notification: JSONRPCNotification = {
    jsonrpc: "2.0",
    method: "initialized",
  };

  // Should not throw and handle gracefully
  await expect(handleMCPNotification(notification)).resolves.toBe(undefined);
});


Deno.test("MCP Compliance - CreateInitializeResult", () => {
  const result = createInitializeResult();

  expect(result.protocolVersion).toBe("2025-03-26");
  expect(result.capabilities).toBeDefined();
  expect(result.capabilities.tools).toBeDefined();
  expect(result.capabilities.resources).toBeDefined();
  expect(result.capabilities.prompts).toBeDefined();
  expect(result.capabilities.logging).toBeDefined();
  expect(result.serverInfo).toBeDefined();
  expect(result.serverInfo.name).toBe("mycelia");
  expect(result.serverInfo.version).toBe("1.0.0");
});
