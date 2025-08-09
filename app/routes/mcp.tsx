import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { 
  handleMCPRequest, 
  handleMCPNotification,
  detectJSONRPCMessageType,
  getMCPServer 
} from "@/lib/mcp/mcp.server.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { JSONRPCRequest, JSONRPCNotification, JSONRPCRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getMCPConfig, validateProtocolVersion } from "@/lib/mcp/config.ts";
import { sessionManager } from "@/lib/mcp/sessions.ts";


export async function loader({ request }: LoaderFunctionArgs) {
  const config = getMCPConfig();
  
  // Validate protocol version
  const protocolVersion = request.headers.get("MCP-Protocol-Version");
  const validVersion = validateProtocolVersion(protocolVersion, config);
  if (!validVersion) {
    return new Response("Bad Request: Invalid or unsupported protocol version", { 
      status: 400 
    });
  }

  if (!config.enableSSE) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // TODO: Implement SSE stream for GET requests
  // For now, return 405 as recommended in the docs
  return new Response("Method Not Allowed: SSE not yet implemented", { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "DELETE") {
    return handleDeleteSession(request);
  }
  
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const config = getMCPConfig();
  
  // Validate protocol version
  const protocolVersion = request.headers.get("MCP-Protocol-Version");
  const validVersion = validateProtocolVersion(protocolVersion, config);
  if (!validVersion) {
    return new Response("Bad Request: Invalid or unsupported protocol version", { 
      status: 400 
    });
  }

  try {
    const auth = await authenticateOr401(request);
    const body = await request.json();
    
    // Detect JSON-RPC message type
    let messageType: string;
    try {
      messageType = detectJSONRPCMessageType(body);
    } catch (error) {
      return new Response("Bad Request: Invalid JSON-RPC message", { status: 400 });
    }

    // Handle different message types according to spec
    switch (messageType) {
      case "request": {
        const jsonRpcRequest = JSONRPCRequestSchema.parse(body);
        
        // Check for session requirement on non-initialize requests
        if (config.enableSessions && jsonRpcRequest.method !== "initialize") {
          const sessionId = request.headers.get("Mcp-Session-Id");
          if (!sessionId || !sessionManager.getSession(sessionId)) {
            return new Response("Bad Request: Missing or invalid session ID", { 
              status: 400 
            });
          }
        }

        console.log(`Available resources: ${Array.from(defaultResourceManager.resources.keys()).join(", ")}`);
        
        const mcpResponse = await handleMCPRequest(
          defaultResourceManager,
          auth,
          jsonRpcRequest
        );

        const headers: HeadersInit = {
          "Content-Type": "application/json",
        };

        // Add session ID header for initialize responses
        if (config.enableSessions && jsonRpcRequest.method === "initialize") {
          const server = getMCPServer(auth, defaultResourceManager);
          const session = sessionManager.createSession(auth, server);
          headers["Mcp-Session-Id"] = session.id;
        }

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
        return new Response("Bad Request: Unknown message type", { status: 400 });
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
        message: error instanceof Error ? error.message : "Unknown error"
      }
    }, { status: 500 });
  }
}

async function handleDeleteSession(request: Request) {
  const config = getMCPConfig();

  if (!config.enableSessions) {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const sessionId = request.headers.get("Mcp-Session-Id");
  if (!sessionId) {
    return new Response("Bad Request: Missing session ID", { status: 400 });
  }

  const deleted = sessionManager.deleteSession(sessionId);
  if (!deleted) {
    return new Response("Not Found: Session not found", { status: 404 });
  }

  return new Response(null, { status: 204 });
}