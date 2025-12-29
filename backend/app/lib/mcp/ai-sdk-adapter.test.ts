import { expect } from "@std/expect";
import { z } from "zod";
import { resourceToAiSdkTools, createAiSdkToolsFromResources } from "./ai-sdk-adapter.ts";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";

// Test resource with simple schema
class SimpleTestResource implements Resource<{ value: string }, { result: string }> {
  code = "test_simple";
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
  code = "test_discriminated";
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

Deno.test("AI SDK Adapter - Simple resource creates valid tool schema", async () => {
  const resource = new SimpleTestResource();
  const tools = resourceToAiSdkTools(resource, mockAuth);

  expect(Object.keys(tools).length).toBe(1);
  const tool = tools["test_simple"];
  expect(tool).toBeDefined();
  expect(tool.execute).toBeDefined();
  
  // Test that the tool can be executed with the correct input
  if (!tool.execute) {
    throw new Error("tool.execute is undefined");
  }
  const result = await tool.execute(
    { value: "test" },
    { toolCallId: "test-call-id", messages: [] }
  );
  expect(result).toEqual({ result: "Processed: test" });
});

Deno.test("AI SDK Adapter - Discriminated union creates multiple tools with correct schemas", async () => {
  const resource = new DiscriminatedUnionResource();
  const tools = resourceToAiSdkTools(resource, mockAuth);

  expect(Object.keys(tools)).toEqual([
    "test_discriminated_get",
    "test_discriminated_set",
  ]);


  const getTool = tools["test_discriminated_get"];
  const setTool = tools["test_discriminated_set"];

  expect(getTool).toBeDefined();
  expect(setTool).toBeDefined();
  expect(getTool.execute).toBeDefined();
  expect(setTool.execute).toBeDefined();

  // Test that get tool works correctly (action discriminator should be omitted from input)
  if (!getTool.execute) {
    throw new Error("getTool.execute is undefined");
  }
  const getResult = await getTool.execute(
    { id: "test-id" },
    { toolCallId: "test-call-id-get", messages: [] }
  );
  expect(getResult).toEqual({ result: "Got test-id" });

  // Test that set tool works correctly (action discriminator should be omitted from input)
  if (!setTool.execute) {
    throw new Error("setTool.execute is undefined");
  }
  const setResult = await setTool.execute(
    { id: "test-id", value: "test-value" },
    { toolCallId: "test-call-id-set", messages: [] }
  );
  expect(setResult).toEqual({ result: "Set test-id to test-value" });
});

// Tests for createAiSdkToolsFromResources (passes Zod schema to AI SDK)

Deno.test("createAiSdkToolsFromResources - Simple resource creates valid tool with Zod schema", async () => {
  const resource = new SimpleTestResource();
  const tools = createAiSdkToolsFromResources([resource], mockAuth);

  expect(Object.keys(tools).length).toBe(1);
  const tool = tools["test_simple"];
  expect(tool).toBeDefined();
  expect(tool.execute).toBeDefined();
  expect(tool.inputSchema).toBeDefined();
  
  // Verify the inputSchema is a Zod schema (has ~standard symbol for AI SDK compatibility)
  const schema = tool.inputSchema as any;
  expect("~standard" in schema).toBe(true);
  
  // Test that the tool can be executed with the correct input
  if (!tool.execute) {
    throw new Error("tool.execute is undefined");
  }
  const result = await tool.execute(
    { value: "test" },
    { toolCallId: "test-call-id", messages: [] }
  );
  expect(result).toEqual({ result: "Processed: test" });
});

Deno.test("createAiSdkToolsFromResources - Discriminated union creates multiple tools with Zod schemas", async () => {
  const resource = new DiscriminatedUnionResource();
  const tools = createAiSdkToolsFromResources([resource], mockAuth);

  expect(Object.keys(tools)).toEqual([
    "test_discriminated_get",
    "test_discriminated_set",
  ]);

  const getTool = tools["test_discriminated_get"];
  const setTool = tools["test_discriminated_set"];

  expect(getTool).toBeDefined();
  expect(setTool).toBeDefined();
  expect(getTool.inputSchema).toBeDefined();
  expect(setTool.inputSchema).toBeDefined();

  // Verify schemas are Zod schemas (have ~standard symbol)
  expect("~standard" in (getTool.inputSchema as any)).toBe(true);
  expect("~standard" in (setTool.inputSchema as any)).toBe(true);

  // Test execution
  if (!getTool.execute) {
    throw new Error("getTool.execute is undefined");
  }
  const getResult = await getTool.execute(
    { id: "test-id" },
    { toolCallId: "test-call-id-get", messages: [] }
  );
  expect(getResult).toEqual({ result: "Got test-id" });

  if (!setTool.execute) {
    throw new Error("setTool.execute is undefined");
  }
  const setResult = await setTool.execute(
    { id: "test-id", value: "test-value" },
    { toolCallId: "test-call-id-set", messages: [] }
  );
  expect(setResult).toEqual({ result: "Set test-id to test-value" });
});

Deno.test("createAiSdkToolsFromResources - Multiple resources combined", async () => {
  const simpleResource = new SimpleTestResource();
  const discriminatedResource = new DiscriminatedUnionResource();
  
  const tools = createAiSdkToolsFromResources([simpleResource, discriminatedResource], mockAuth);

  expect(Object.keys(tools).sort()).toEqual([
    "test_discriminated_get",
    "test_discriminated_set",
    "test_simple",
  ]);
  
  // Verify all tools are executable
  expect(tools["test_simple"].execute).toBeDefined();
  expect(tools["test_discriminated_get"].execute).toBeDefined();
  expect(tools["test_discriminated_set"].execute).toBeDefined();
});

// Test resource with z.any() - common pattern in real resources
class ResourceWithAnySchema implements Resource<{ data: any }, { result: any }> {
  code = "test_any";
  description = "Test resource with z.any()";
  schemas = {
    request: z.object({ data: z.any() }),
    response: z.object({ result: z.any() }),
  };

  async use(input: { data: any }, _auth: Auth): Promise<{ result: any }> {
    return { result: input.data };
  }

  extractActions(_input: { data: any }) {
    return [{ path: ["test", "any"], actions: ["read"] }];
  }
}

Deno.test("createAiSdkToolsFromResources - Resource with z.any() field creates valid tool", async () => {
  const resource = new ResourceWithAnySchema();
  const tools = createAiSdkToolsFromResources([resource], mockAuth);

  expect(Object.keys(tools).length).toBe(1);
  const tool = tools["test_any"];
  expect(tool).toBeDefined();
  expect(tool.inputSchema).toBeDefined();
  
  // Verify it's a Zod schema
  expect("~standard" in (tool.inputSchema as any)).toBe(true);
  
  // Test execution
  if (!tool.execute) {
    throw new Error("tool.execute is undefined");
  }
  const result = await tool.execute(
    { data: { nested: "value" } },
    { toolCallId: "test-call-id", messages: [] }
  );
  expect(result).toEqual({ result: { nested: "value" } });
});

// Test resource with optional fields
class ResourceWithOptionalFields implements Resource<
  { required: string; optional?: string },
  { result: string }
> {
  code = "test_optional";
  description = "Test resource with optional fields";
  schemas = {
    request: z.object({
      required: z.string(),
      optional: z.string().optional(),
    }),
    response: z.object({ result: z.string() }),
  };

  async use(
    input: { required: string; optional?: string },
    _auth: Auth
  ): Promise<{ result: string }> {
    return { result: `${input.required}-${input.optional ?? "none"}` };
  }

  extractActions(_input: { required: string; optional?: string }) {
    return [{ path: ["test", "optional"], actions: ["read"] }];
  }
}

Deno.test("createAiSdkToolsFromResources - Resource with optional fields works correctly", async () => {
  const resource = new ResourceWithOptionalFields();
  const tools = createAiSdkToolsFromResources([resource], mockAuth);

  const tool = tools["test_optional"];
  expect(tool).toBeDefined();
  
  // Verify it's a Zod schema
  expect("~standard" in (tool.inputSchema as any)).toBe(true);
  
  // Test execution with and without optional
  if (!tool.execute) {
    throw new Error("tool.execute is undefined");
  }
  
  const result1 = await tool.execute(
    { required: "test" },
    { toolCallId: "test-call-id-1", messages: [] }
  );
  expect(result1).toEqual({ result: "test-none" });
  
  const result2 = await tool.execute(
    { required: "test", optional: "value" },
    { toolCallId: "test-call-id-2", messages: [] }
  );
  expect(result2).toEqual({ result: "test-value" });
});

// Smoke tests with real resources from the codebase

import { MongoResource } from "@/lib/mongo/core.server.ts";
import { TimelineResource } from "@/lib/timeline/resource.server.ts";
import { ObjectsResource } from "@/lib/objects/resource.server.ts";

const realResourceAuth = new Auth({
  principal: "test-user",
  policies: [
    {
      effect: "allow",
      resource: "**",
      action: "*",
    },
  ],
});

Deno.test("createAiSdkToolsFromResources - Smoke test with MongoResource", () => {
  const resource = new MongoResource();
  const tools = createAiSdkToolsFromResources([resource], realResourceAuth);

  // MongoResource has a discriminated union with many actions
  const toolNames = Object.keys(tools);
  expect(toolNames.length).toBeGreaterThan(0);
  
  // Check that expected mongo tools exist
  expect(toolNames).toContain("mongo_find");
  expect(toolNames).toContain("mongo_findOne");
  expect(toolNames).toContain("mongo_insertOne");
  expect(toolNames).toContain("mongo_updateOne");
  expect(toolNames).toContain("mongo_deleteOne");
  
  // Verify all tools have valid Zod inputSchema
  for (const [_name, tool] of Object.entries(tools)) {
    expect(tool.inputSchema).toBeDefined();
    const schema = tool.inputSchema as any;
    // Verify it's a Zod schema with ~standard symbol
    expect("~standard" in schema).toBe(true);
  }
});

Deno.test("createAiSdkToolsFromResources - Smoke test with TimelineResource", () => {
  const resource = new TimelineResource();
  const tools = createAiSdkToolsFromResources([resource], realResourceAuth);

  const toolNames = Object.keys(tools);
  expect(toolNames.length).toBeGreaterThan(0);
  
  // Check that expected timeline tools exist
  expect(toolNames).toContain("timeline_recalculate");
  expect(toolNames).toContain("timeline_ensureIndex");
  expect(toolNames).toContain("timeline_invalidate");
  
  // Verify all tools have valid Zod inputSchema
  for (const [_name, tool] of Object.entries(tools)) {
    expect(tool.inputSchema).toBeDefined();
    const schema = tool.inputSchema as any;
    expect("~standard" in schema).toBe(true);
  }
});

Deno.test("createAiSdkToolsFromResources - Smoke test with ObjectsResource", () => {
  const resource = new ObjectsResource();
  const tools = createAiSdkToolsFromResources([resource], realResourceAuth);

  const toolNames = Object.keys(tools);
  expect(toolNames.length).toBeGreaterThan(0);
  
  // Check that expected objects tools exist
  expect(toolNames).toContain("objects_create");
  expect(toolNames).toContain("objects_get");
  expect(toolNames).toContain("objects_list");
  expect(toolNames).toContain("objects_update");
  expect(toolNames).toContain("objects_delete");
  
  // Verify all tools have valid Zod inputSchema
  for (const [_name, tool] of Object.entries(tools)) {
    expect(tool.inputSchema).toBeDefined();
    const schema = tool.inputSchema as any;
    expect("~standard" in schema).toBe(true);
  }
});

Deno.test("createAiSdkToolsFromResources - Smoke test with all real resources combined (as in api.chat)", () => {
  const mongoResource = new MongoResource();
  const timelineResource = new TimelineResource();
  const objectsResource = new ObjectsResource();
  
  const resources = [mongoResource, timelineResource, objectsResource];
  
  const tools = createAiSdkToolsFromResources(resources, realResourceAuth);

  const toolNames = Object.keys(tools);
  
  // Should have tools from all 3 resources
  expect(toolNames.some(n => n.startsWith("mongo_"))).toBe(true);
  expect(toolNames.some(n => n.startsWith("timeline_"))).toBe(true);
  expect(toolNames.some(n => n.startsWith("objects_"))).toBe(true);
  
  // Verify all tools have valid Zod inputSchema and are executable
  for (const [_name, tool] of Object.entries(tools)) {
    expect(tool.inputSchema).toBeDefined();
    expect(tool.execute).toBeDefined();
    
    const schema = tool.inputSchema as any;
    expect("~standard" in schema).toBe(true);
  }
  
  console.log(`Created ${toolNames.length} tools from real resources:`, toolNames.sort());
});

