import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import {
  detectJSONRPCMessageType,
  handleMCPNotification,
  handleMCPRequest,
} from "@/lib/mcp/mcp.server.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import {
  JSONRPCNotification,
  JSONRPCRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getMCPConfig, validateProtocolVersion } from "@/lib/mcp/config.ts";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticateOr401(request);

  return Response.json({
    message: "MCP endpoint - Use POST to call MCP tools",
    authenticated: true,
    principal: auth.principal,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const config = getMCPConfig();

  // Validate protocol version
  const protocolVersion = request.headers.get("MCP-Protocol-Version");
  const validVersion = validateProtocolVersion(protocolVersion, config);
  if (!validVersion) {
    return new Response(
      "Bad Request: Invalid or unsupported protocol version",
      {
        status: 400,
      },
    );
  }

  try {
    const auth = await authenticateOr401(request);
    const body = await request.json();

    // Detect JSON-RPC message type
    let messageType: string;
    try {
      messageType = detectJSONRPCMessageType(body);
    } catch (error) {
      return new Response("Bad Request: Invalid JSON-RPC message", {
        status: 400,
      });
    }

    // Handle different message types according to spec
    switch (messageType) {
      case "request": {
        const jsonRpcRequest = JSONRPCRequestSchema.parse(body);

        const mcpResponse = await handleMCPRequest(
          defaultResourceManager,
          auth,
          jsonRpcRequest,
        );

        const headers: HeadersInit = {
          "Content-Type": "application/json",
        };

        return Response.json(mcpResponse, {
          status: 200,
          headers,
        });
      }

      case "notification": {
        const notification = body as JSONRPCNotification;

        // Handle notification (no response expected)
        await handleMCPNotification(notification);

        return new Response(null, { status: 202 }); // Accepted, no body
      }

      case "response":
      case "error": {
        // Client sent a response/error to us (unusual for HTTP transport)
        // Accept it but don't process
        return new Response(null, { status: 202 }); // Accepted, no body
      }

      default:
        return new Response("Bad Request: Unknown message type", {
          status: 400,
        });
    }
  } catch (error) {
    console.error("MCP call failed:", error);

    if (error instanceof Response) {
      return error;
    }

    // Return JSON-RPC error response for server errors
    return Response.json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    }, { status: 500 });
  }
}
