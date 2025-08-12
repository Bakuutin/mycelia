import { expect } from "@std/expect";
import { action, loader } from "@/routes/mcp.tsx";
import { withFixtures } from "@/tests/fixtures.server.ts";

function createMockLoaderArgs(url: string, headers?: HeadersInit) {
  return {
    request: new Request(url, { headers }),
    params: {},
    context: {},
  };
}

function createMockActionArgs(request: Request) {
  return {
    request,
    params: {},
    context: {},
  };
}

Deno.test(
  "MCP route loader: should return info when authenticated",
  withFixtures(["TestApiKey"], async (token: string) => {
    const response = await loader(
      createMockLoaderArgs("http://localhost:3000/mcp", {
        "Authorization": `Bearer ${token}`,
      }),
    );
    const data = await response.json();

    expect(data.message).toBe("MCP endpoint - Use POST to call MCP tools");
    expect(data.authenticated).toBe(true);
    expect(data.principal).toBe("test-owner");
  }),
);

Deno.test(
  "MCP route loader: should require authentication",
  withFixtures([], async () => {
    try {
      await loader(createMockLoaderArgs("http://localhost:3000/mcp"));
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(401);
    }
  }),
);

Deno.test(
  "MCP route action: should reject GET requests",
  withFixtures(["TestApiKey"], async (token: string) => {
    const request = new Request("http://localhost:3000/mcp", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    const response = await action(createMockActionArgs(request));
    expect(response.status).toBe(405);
  }),
);

Deno.test(
  "MCP route action: should require authentication",
  withFixtures([], async () => {
    const request = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "mongo", arguments: {} },
      }),
    });

    const response = await action(createMockActionArgs(request));
    expect(response.status).toBe(401);
  }),
);

Deno.test(
  "MCP route action: should require tool parameter",
  withFixtures(["TestApiKey"], async (token: string) => {
    const request = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { args: {} },
      }),
    });

    const response = await action(createMockActionArgs(request));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Tool name is required");
  }),
);

Deno.test(
  "MCP route action: should call MCP tool with valid request",
  withFixtures(["TestApiKey"], async (token: string) => {
    const request = new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "tech.mycelia.mongo",
          arguments: {
            action: "find",
            collection: "test",
            query: {},
          },
        },
      }),
    });

    const response = await action(createMockActionArgs(request));
    const data = await response.json();
    expect(data).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: "[]",
          },
        ],
        isError: false,
      },
    });
  }),
);
