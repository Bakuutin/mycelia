import { expect } from "@std/expect";
import { z } from "zod";
import { ResourceManager, Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { handleMCPRequest } from "./mcp.server.ts";
import { JSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { MongoResource } from "@/lib/mongo/core.server.ts";

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

Deno.test(
  "MCP Server - tools/list returns available tools",
  withFixtures([ResourceManager, "Admin"], async (resourceManager: ResourceManager, auth: Auth) => {
    resourceManager.registerResource(new SimpleTestResource());

    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    };

    const response = await handleMCPRequest(resourceManager, auth, request);

    expect(response).toBeDefined();
    expect(response).toHaveProperty("result");
    
    const result = (response as any).result as { tools: any[] };
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBe(1);
    expect(result.tools[0].name).toBe("test_simple");
    expect(result.tools[0].description).toBe("Simple test resource");
    expect(result.tools[0].inputSchema).toEqual({
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
      additionalProperties: false,
    })
  
  })
);

Deno.test(
  "MCP Server - tools/call executes tool successfully",
  withFixtures([ResourceManager, "Admin"], async (resourceManager: ResourceManager, auth: Auth) => {
    resourceManager.registerResource(new SimpleTestResource());

    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "test_simple",
        arguments: {
          value: "test-value",
        },
      },
    };

    const response = await handleMCPRequest(resourceManager, auth, request);

    expect(response).toBeDefined();
    expect(response).toHaveProperty("result");
    
    if ("result" in response) {
      const result = response.result as { content: { type: string; text: string }[] };
      expect(result.content).toBeDefined();
      expect(result.content.length).toBe(1);
      expect(result.content[0].type).toBe("text");
      
      // The response is EJSON stringified
      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent).toEqual({ result: "Processed: test-value" });
    } else {
      throw new Error("Response should have result");
    }
  })
);

Deno.test(
  "MCP Server - tools/call returns error for unknown tool",
  withFixtures([ResourceManager, "Admin"], async (resourceManager: ResourceManager, auth: Auth) => {
    resourceManager.registerResource(new SimpleTestResource());

    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "unknown_tool",
        arguments: {},
      },
    };

    const response = await handleMCPRequest(resourceManager, auth, request);

    expect(response).toBeDefined();
    expect(response).toHaveProperty("error");
    
    if ("error" in response) {
      expect(response.error.code).toBe(-32601); // Method not found / Tool not found
      expect(response.error.message).toContain("Tool not found");
    } else {
      throw new Error("Response should have error");
    }
  })
);

Deno.test(
  "MCP Server - mongo resource integration",
  withFixtures([ResourceManager, "Admin"], async (resourceManager: ResourceManager, auth: Auth) => {
    // Manually create and register MongoResource with mocked DB
    const mongoResource = new MongoResource();
    
    // Mock getRootDB
    (mongoResource as any).getRootDB = async () => {
        return {
            collection: (name: string) => ({
                insertOne: async (doc: any) => ({ insertedId: "mock_id", ...doc }),
                find: () => ({
                    batchSize: () => ({
                        limit: () => ({
                            toArray: async () => ([{ name: "test_item", value: 123 }])
                        })
                    })
                }),
                listCollections: () => ({
                    toArray: async () => [{ name: "test_collection" }],
                    hasNext: async () => true // for listIndexes check
                }),
                createCollection: async () => {},
            })
        } as any;
    };
    // Mock ensureCollectionExists
    (mongoResource as any).ensureCollectionExists = async () => {};

    resourceManager.registerResource(mongoResource);
    
    // 1. Test insertOne via MCP
    const insertRequest: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "mongo_insertOne",
        arguments: {
          collection: "test_collection",
          doc: { name: "test_item", value: 123 }
        },
      },
    };

    const insertResponse = await handleMCPRequest(resourceManager, auth, insertRequest);
    expect(insertResponse).toHaveProperty("result");
    
    // 2. Test find via MCP
    const findRequest: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "mongo_find",
        arguments: {
          collection: "test_collection",
          query: { name: "test_item" }
        },
      },
    };

    const findResponse = await handleMCPRequest(resourceManager, auth, findRequest);
    expect(findResponse).toHaveProperty("result");
    
    if ("result" in findResponse) {
      const result = findResponse.result as { content: { type: string; text: string }[] };
      const parsedContent = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsedContent)).toBeTruthy();
      expect(parsedContent.length).toBe(1);
      expect(parsedContent[0].name).toBe("test_item");
      expect(parsedContent[0].value).toBe(123);
    }
  })
);
