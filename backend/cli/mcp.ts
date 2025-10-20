import { getJWT } from "./utils.ts";
import { CliConfig, getUrl } from "./config.ts";

export async function handleMCPListTools(config: CliConfig): Promise<void> {
  try {
    const accessToken = await getJWT(config);

    // List tools using proper JSON-RPC
    const response = await fetch(getUrl("/mcp"), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
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

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

export async function handleMCPCallTool(
  config: CliConfig,
  toolName: string,
  argsJson?: string,
): Promise<void> {
  try {
    const accessToken = await getJWT(config);

    let args: Record<string, any> = {};
    if (argsJson) {
      try {
        args = JSON.parse(argsJson);
      } catch (error) {
        console.error("Invalid JSON arguments:", (error as Error).message);
        Deno.exit(1);
      }
    }

    console.log(`\n🚀 Calling tool: ${toolName}`);
    if (Object.keys(args).length > 0) {
      console.log(`📝 Arguments: ${JSON.stringify(args, null, 2)}`);
    }
    console.log(`⏳ Processing... (check server logs for progress)\n`);

    const startTime = Date.now();
    const progressInterval: number = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `\r⏱️  Elapsed: ${formatElapsed(elapsed)} (still processing...)`,
        ),
      );
    }, 1000);

    const response = await fetch(getUrl("/mcp"), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-03-26",
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

    if (progressInterval) {
      clearInterval(progressInterval);
      console.log("\r" + " ".repeat(60) + "\r"); // Clear the progress line
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`❌ MCP call failed (${totalTime}s):`, errorBody);
      Deno.exit(1);
    }

    const result = await response.json();

    if (result.error) {
      console.error(
        `❌ Tool call failed (${totalTime}s):`,
        result.error.message,
      );
      Deno.exit(1);
    }

    // Print successful result
    console.log(`✅ Completed in ${totalTime}s\n`);
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
    console.error("❌ Failed to call MCP tool:", (error as Error).message);
    Deno.exit(1);
  }
}
