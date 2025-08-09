import { getJWT } from "./utils.ts";
import { CliConfig, getUrl } from "./config.ts";

let sessionId: string | null = null;

export async function handleMCPListTools(config: CliConfig): Promise<void> {
  try {
    const accessToken = await getJWT(config);
    
    // Initialize session if we don't have one
    if (!sessionId) {
      await initializeSession(config, accessToken);
    }
    
    // List tools using proper JSON-RPC
    const response = await fetch(getUrl("/mcp"), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
        "Mcp-Session-Id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Failed to list MCP tools:", errorBody);
      Deno.exit(1);
    }

    const result = await response.json();
    
    if (result.error) {
      console.error("Failed to list tools:", result.error.message);
      Deno.exit(1);
    }

    if (result.result?.tools && Array.isArray(result.result.tools)) {
      console.log("Available MCP tools:");
      for (const tool of result.result.tools) {
        console.log(`- ${tool.name}: ${tool.description || "No description"}`);
      }
    } else {
      console.log("No tools available");
    }
  } catch (error) {
    console.error("Failed to list MCP tools:", (error as Error).message);
    Deno.exit(1);
  }
}

async function initializeSession(config: CliConfig, accessToken: string): Promise<void> {
  const response = await fetch(getUrl("/mcp"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "mycelia-cli",
          version: "1.0.0",
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Failed to initialize MCP session:", errorBody);
    Deno.exit(1);
  }

  const result = await response.json();
  
  if (result.error) {
    console.error("Failed to initialize:", result.error.message);
    Deno.exit(1);
  }

  // Get session ID from response headers
  sessionId = response.headers.get("Mcp-Session-Id");
  if (!sessionId) {
    console.error("No session ID received from server");
    Deno.exit(1);
  }

  // Send initialized notification
  await fetch(getUrl("/mcp"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-03-26",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialized",
    }),
  });
}

export async function handleMCPCallTool(
  config: CliConfig,
  toolName: string,
  argsJson?: string,
): Promise<void> {
  try {
    const accessToken = await getJWT(config);
    
    // Initialize session if we don't have one
    if (!sessionId) {
      await initializeSession(config, accessToken);
    }
    
    let args: Record<string, any> = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch (error) {
        console.error("Invalid JSON arguments:", (error as Error).message);
        Deno.exit(1);
      }
    }
    
    const response = await fetch(getUrl("/mcp"), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
        "Mcp-Session-Id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("MCP call failed:", errorBody);
      Deno.exit(1);
    }

    const result = await response.json();
    
    if (result.error) {
      console.error("Tool call failed:", result.error.message);
      Deno.exit(1);
    }
    
    // Print successful result
    if (result.result?.content) {
      for (const content of result.result.content) {
        if (content.type === "text") {
          console.log(content.text);
        }
      }
    } else {
      console.log(JSON.stringify(result.result, null, 2));
    }
  } catch (error) {
    console.error("Failed to call MCP tool:", (error as Error).message);
    Deno.exit(1);
  }
}