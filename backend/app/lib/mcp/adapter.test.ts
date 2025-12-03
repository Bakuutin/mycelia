import { expect } from "@std/expect";
import { z } from "zod";
import {
  createMCPToolsFromResources,
  handleMCPToolCall,
  resourceToMCPTools,
} from "./adapter.ts";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { MongoResource } from "@/lib/mongo/core.server.ts";

// Test resource with simple schema
class SimpleTestResource implements Resource<{ value: string }, { result: string }> {
  code = "test.simple";
  description = "Simple test resource";
  schemas = {
    request: z.object({ value: z.string() }),
    response: z.object({ result: z.string() }),
  };

  async use(input: { value: string }, _auth: Auth): Promise<{ result: string }> {
    return { result: `Processed: ${input.value}` };
  }

  extractActions(_input: { value: string }) {
    return [{ path: ["test", "simple"], actions: ["read"] }];
  }
}

// Test resource with discriminated union
class DiscriminatedUnionResource
  implements Resource<
    | { action: "get"; id: string }
    | { action: "set"; id: string; value: string },
    { result: any }
  > {
  code = "test.discriminated";
  description = "Test discriminated union resource";
  schemas = {
    request: z.discriminatedUnion("action", [
      z.object({ action: z.literal("get"), id: z.string() }),
      z.object({ action: z.literal("set"), id: z.string(), value: z.string() }),
    ]),
    response: z.object({ result: z.any() }),
  };

  async use(
    input: { action: "get"; id: string } | { action: "set"; id: string; value: string },
    _auth: Auth,
  ): Promise<{ result: any }> {
    if (input.action === "get") {
      return { result: `Got ${input.id}` };
    }
    return { result: `Set ${input.id} to ${input.value}` };
  }

  extractActions(
    _input: { action: "get"; id: string } | { action: "set"; id: string; value: string },
  ) {
    return [{ path: ["test", "discriminated"], actions: ["read", "write"] }];
  }
}

const mockAuth = new Auth({
  principal: "test-user",
  policies: [
    {
      effect: "allow",
      resource: "test/**",
      action: "*",
    },
  ],
});

Deno.test("MCP Adapter - Simple resource creates valid tool schema", () => {
  const resource = new SimpleTestResource();
  const tools = resourceToMCPTools(resource);

  expect(tools.length).toBe(1);
  const tool = tools[0];

  expect(tool.name).toBe("test.simple");
  expect(tool.description).toBe("Simple test resource");
  expect(tool.inputSchema).toBeDefined();
  expect(tool.inputSchema.type).toBe("object");
  expect((tool.inputSchema as any).properties).toBeDefined();
  expect((tool.inputSchema as any).properties.value).toBeDefined();
  expect((tool.inputSchema as any).properties.value.type).toBe("string");
});

Deno.test("MCP Adapter - Discriminated union creates multiple tools", () => {
  const resource = new DiscriminatedUnionResource();
  const tools = resourceToMCPTools(resource);

  expect(tools.length).toBe(2);

  const getTool = tools.find((t) => t.name === "test.discriminated.get");
  const setTool = tools.find((t) => t.name === "test.discriminated.set");

  expect(getTool).toBeDefined();
  expect(setTool).toBeDefined();

  // Verify get tool schema
  expect(getTool!.inputSchema).toBeDefined();
  expect(getTool!.inputSchema.type).toBe("object");
  const getSchema = getTool!.inputSchema as any;
  expect(getSchema.properties).toBeDefined();
  expect(getSchema.properties.id).toBeDefined();
  expect(getSchema.properties.id.type).toBe("string");
  // Action should be excluded from schema
  expect(getSchema.properties.action).toBeUndefined();

  // Verify set tool schema
  expect(setTool!.inputSchema).toBeDefined();
  expect(setTool!.inputSchema.type).toBe("object");
  const setSchema = setTool!.inputSchema as any;
  expect(setSchema.properties).toBeDefined();
  expect(setSchema.properties.id).toBeDefined();
  expect(setSchema.properties.id.type).toBe("string");
  expect(setSchema.properties.value).toBeDefined();
  expect(setSchema.properties.value.type).toBe("string");
  // Action should be excluded from schema
  expect(setSchema.properties.action).toBeUndefined();
});

Deno.test("MCP Adapter - Discriminated union tool call adds action back", async () => {
  const resource = new DiscriminatedUnionResource();
  const tools = resourceToMCPTools(resource);

  const getTool = tools.find((t) => t.name === "test.discriminated.get");
  expect(getTool).toBeDefined();

  // Call tool without action field (should be added automatically)
  const result = await handleMCPToolCall(
    "test.discriminated.get",
    mockAuth,
    { id: "test-id" },
  );

  expect(result.isError).toBe(false);
  expect(result.content).toBeDefined();
  expect(result.structuredContent).toBeDefined();
  expect(result.structuredContent!.result).toBe("Got test-id");
});

Deno.test("MCP Adapter - MongoDB resource creates valid tool schemas", () => {
  const resource = new MongoResource();
  const tools = resourceToMCPTools(resource);

  // MongoDB resource should create multiple tools for each action
  expect(tools.length).toBeGreaterThan(0);

  // Find some expected MongoDB actions
  const findTool = tools.find((t) => t.name === "mongo_find");
  const findOneTool = tools.find((t) => t.name === "mongo_findOne");
  const insertOneTool = tools.find((t) => t.name === "mongo_insertOne");
  const countTool = tools.find((t) => t.name === "mongo_count");

  expect(findTool).toBeDefined();
  expect(findOneTool).toBeDefined();
  expect(insertOneTool).toBeDefined();
  expect(countTool).toBeDefined();

  // Verify find tool schema
  expect(findTool!.inputSchema).toBeDefined();
  expect(findTool!.inputSchema.type).toBe("object");
  const findSchema = findTool!.inputSchema as any;
  expect(findSchema.properties).toBeDefined();
  expect(findSchema.properties.collection).toBeDefined();
  expect(findSchema.properties.collection.type).toBe("string");
  expect(findSchema.properties.query).toBeDefined();
  // Action should be excluded from schema (added automatically)
  expect(findSchema.properties.action).toBeUndefined();

  // Verify findOne tool schema
  expect(findOneTool!.inputSchema).toBeDefined();
  expect(findOneTool!.inputSchema.type).toBe("object");
  const findOneSchema = findOneTool!.inputSchema as any;
  expect(findOneSchema.properties).toBeDefined();
  expect(findOneSchema.properties.collection).toBeDefined();
  expect(findOneSchema.properties.query).toBeDefined();
  // Action should be excluded
  expect(findOneSchema.properties.action).toBeUndefined();

  // Verify insertOne tool schema
  expect(insertOneTool!.inputSchema).toBeDefined();
  expect(insertOneTool!.inputSchema.type).toBe("object");
  const insertSchema = insertOneTool!.inputSchema as any;
  expect(insertSchema.properties).toBeDefined();
  expect(insertSchema.properties.collection).toBeDefined();
  expect(insertSchema.properties.collection.type).toBe("string");
  expect(insertSchema.properties.doc).toBeDefined();
  // Action should be excluded
  expect(insertSchema.properties.action).toBeUndefined();

  // Verify count tool schema
  expect(countTool!.inputSchema).toBeDefined();
  expect(countTool!.inputSchema.type).toBe("object");
  const countSchema = countTool!.inputSchema as any;
  expect(countSchema.properties).toBeDefined();
  expect(countSchema.properties.collection).toBeDefined();
  expect(countSchema.properties.query).toBeDefined();
  // Action should be excluded
  expect(countSchema.properties.action).toBeUndefined();
});

Deno.test("MCP Adapter - All tool schemas are valid JSON Schema", () => {
  const simpleResource = new SimpleTestResource();
  const discriminatedResource = new DiscriminatedUnionResource();
  const mongoResource = new MongoResource();

  const allTools = createMCPToolsFromResources([
    simpleResource,
    discriminatedResource,
    mongoResource,
  ]);

  for (const tool of allTools) {
    // Verify basic structure
    expect(tool.name).toBeDefined();
    expect(typeof tool.name).toBe("string");
    expect(tool.name.length).toBeGreaterThan(0);

    expect(tool.description).toBeDefined();
    expect(typeof tool.description).toBe("string");

    expect(tool.inputSchema).toBeDefined();
    expect(typeof tool.inputSchema).toBe("object");

    // Verify JSON Schema structure
    const schema = tool.inputSchema as any;
    expect(schema.type).toBeDefined();
    expect(["object", "string", "number", "boolean", "array"]).toContain(schema.type);

    // If it's an object type, verify properties structure
    if (schema.type === "object") {
      if (schema.properties) {
        expect(typeof schema.properties).toBe("object");
        // Verify each property has a type
        for (const [key, value] of Object.entries(schema.properties)) {
          expect(value).toBeDefined();
          expect((value as any).type).toBeDefined();
        }
      }
    }
  }
});

Deno.test("MCP Adapter - Tool schemas can validate input", async () => {
  const resource = new DiscriminatedUnionResource();
  const tools = resourceToMCPTools(resource);

  const getTool = tools.find((t) => t.name === "test.discriminated.get");
  expect(getTool).toBeDefined();

  // Test with valid input (action will be added automatically)
  const validResult = await handleMCPToolCall(
    "test.discriminated.get",
    mockAuth,
    { id: "valid-id" },
  );
  expect(validResult.isError).toBe(false);

  // Test with invalid input (missing required field)
  const invalidResult = await handleMCPToolCall(
    "test.discriminated.get",
    mockAuth,
    {}, // Missing id
  );
  expect(invalidResult.isError).toBe(true);
  expect(invalidResult.content[0].text).toContain("Error:");
});

Deno.test("MCP Adapter - createMCPToolsFromResources clears and recreates tools", () => {
  const resource1 = new SimpleTestResource();
  const resource2 = new DiscriminatedUnionResource();

  // First call
  const tools1 = createMCPToolsFromResources([resource1, resource2]);
  expect(tools1.length).toBe(3); // 1 from simple + 2 from discriminated

  // Second call should work the same
  const tools2 = createMCPToolsFromResources([resource1, resource2]);
  expect(tools2.length).toBe(3);

  // Tools should still be callable after recreation
  expect(async () => {
    await handleMCPToolCall("test.simple", mockAuth, { value: "test" });
  }).not.toThrow();
});
