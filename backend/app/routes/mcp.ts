import type { Request, Response } from "express";
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

export async function mcpGetHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);
    res.json({
      message: "MCP endpoint - Use POST to call MCP tools",
      authenticated: true,
      principal: auth.principal,
    });
  } catch (error) {
    if (error instanceof globalThis.Response) {
      const status = error.status;
      const body = await error.json().catch(() => ({}));
      res.status(status === 403 ? 401 : status).json(body);
      return;
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return; // Already sent 401 response
    }
    console.error("Error in GET /mcp:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function mcpPostHandler(req: Request, res: Response) {
  const config = getMCPConfig();

  // Validate protocol version
  const protocolVersion = req.headers["mcp-protocol-version"] as
    | string
    | undefined;
  const validVersion = validateProtocolVersion(protocolVersion || null, config);
  if (!validVersion) {
    res.status(400).json({
      error: "Bad Request: Invalid or unsupported protocol version",
    });
    return;
  }

  try {
    const auth = await authenticateOr401(req, res);
    const body = req.body;

    // Detect JSON-RPC message type
    let messageType: string;
    try {
      messageType = detectJSONRPCMessageType(body);
    } catch (error) {
      res.status(400).json({
        error: "Bad Request: Invalid JSON-RPC message",
      });
      return;
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

        res.setHeader("Content-Type", "application/json");
        res.status(200).json(mcpResponse);
        return;
      }

      case "notification": {
        const notification = body as JSONRPCNotification;

        // Handle notification (no response expected)
        await handleMCPNotification(notification);

        res.status(202).send(); // Accepted, no body
        return;
      }

      case "response":
      case "error": {
        // Client sent a response/error to us (unusual for HTTP transport)
        // Accept it but don't process
        res.status(202).send(); // Accepted, no body
        return;
      }

      default:
        res.status(400).json({
          error: "Bad Request: Unknown message type",
        });
        return;
    }
  } catch (error) {
    if (error instanceof globalThis.Response) {
      const status = error.status;
      const body = await error.json().catch(() => ({}));
      res.status(status === 403 ? 401 : status).json(body);
      return;
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return; // Already sent 401 response
    }

    console.error("MCP call failed:", error);

    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      "json" in error &&
      typeof error.json === "function"
    ) {
      const response = error as Response;
      const responseBody = await response.json();
      res.status(response.status).json(responseBody);
      return;
    }

    // Return JSON-RPC error response for server errors
    res.status(500).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}
