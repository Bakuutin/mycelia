import { expect } from "@std/expect";
import { mcpGetHandler, mcpPostHandler } from "@/routes/mcp.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

Deno.test(
  "MCP route GET: should return info when authenticated",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      mcpGetHandler,
      "http://localhost:3000/mcp",
      { headers },
    );
    const data = await response.json();

    expect(data.message).toBe("MCP endpoint - Use POST to call MCP tools");
    expect(data.authenticated).toBe(true);
    expect(data.principal).toBe("admin");
  }),
);

Deno.test(
  "MCP route GET: should require authentication",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      mcpGetHandler,
      "http://localhost:3000/mcp",
    );
    expect(response.status).toBe(401);
  }),
);

Deno.test(
  "MCP route POST: should require authentication",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      mcpPostHandler,
      "http://localhost:3000/mcp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2024-11-05",
        },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "mongo", arguments: {} },
        },
      },
    );
    expect(response.status).toBe(401);
  }),
);

Deno.test(
  "MCP route POST: should require tool parameter",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      mcpPostHandler,
      "http://localhost:3000/mcp",
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2024-11-05",
        },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { args: {} },
        },
      },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toBe("Invalid params: name is required");
  }),
);

Deno.test(
  "MCP route POST: should call MCP tool with valid request",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      mcpPostHandler,
      "http://localhost:3000/mcp",
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2024-11-05",
        },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "mongo_find",
            arguments: {
              collection: "test",
              query: {},
            },
          },
        },
      },
    );
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
      },
    });
  }),
);
