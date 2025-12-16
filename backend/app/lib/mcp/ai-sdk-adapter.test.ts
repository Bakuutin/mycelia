import { expect } from "@std/expect";
import { z } from "zod";
import { resourceToAiSdkTools } from "./ai-sdk-adapter.ts";
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

