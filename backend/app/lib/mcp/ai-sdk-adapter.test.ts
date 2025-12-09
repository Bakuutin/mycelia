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

Deno.test("AI SDK Adapter - Simple resource creates valid tool schema", () => {
  const resource = new SimpleTestResource();
  const tools = resourceToAiSdkTools(resource, mockAuth);

  expect(Object.keys(tools).length).toBe(1);
  const tool = tools["test_simple"];
  expect(tool).toBeDefined();
  
  // In AI SDK, the tool itself doesn't expose the raw Zod schema easily on the 'parameters' property 
  // (it might be internal or transformed to JSON Schema). 
  // But we can check if it works or inspect properties if accessible.
  // The 'tool' function returns an object that has 'parameters' which is the Zod schema.
  
  expect((tool as any).parameters).toBeDefined();
  const params = (tool as any).parameters as z.ZodObject<any>;
  expect(params).toBeInstanceOf(z.ZodObject);
  expect(params.shape.value).toBeDefined();
});

Deno.test("AI SDK Adapter - Discriminated union creates multiple tools with correct schemas", () => {
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

  // Check get tool schema
  const getParams = (getTool as any).parameters as z.ZodObject<any>;
  expect(getParams).toBeInstanceOf(z.ZodObject);
  expect(getParams.shape.id).toBeDefined();
  // The 'action' discriminator should be omitted from the schema exposed to the LLM
  expect(getParams.shape.action).toBeUndefined();

  // Check set tool schema
  const setParams = (setTool as any).parameters as z.ZodObject<any>;
  expect(setParams).toBeInstanceOf(z.ZodObject);
  expect(setParams.shape.id).toBeDefined();
  expect(setParams.shape.value).toBeDefined();
  // The 'action' discriminator should be omitted from the schema exposed to the LLM
  expect(setParams.shape.action).toBeUndefined();
});

