import { exit } from "node:process";
import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { handleLogin } from "./cli/auth.ts";
import { handleMCPCallTool, handleMCPListTools } from "./cli/mcp.ts";
import { getConfig } from "./cli/config.ts";

const root = new Command()
  .name("deno run --env cli.ts")
  .action(() => {
    console.log(root.getHelp());
  })
  .command("completions", new CompletionsCommand())
  .command(
    "login",
    new Command()
      .description("Login to the API")
      .action(async () => {
        const config = getConfig();
        await handleLogin(config);
      }),
  )
  .command(
    "mcp",
    new Command()
      .description("MCP (Model Context Protocol) commands")
      .command(
        "list",
        new Command()
          .description("List available MCP tools")
          .action(async () => {
            const config = getConfig();
            await handleMCPListTools(config);
          }),
      )
      .command(
        "call",
        new Command()
          .description("Call an MCP tool")
          .arguments("<tool:string>")
          .option(
            "-a, --args <args>",
            "Tool arguments as JSON string",
          )
          .action(
            async (
              options: { args?: string },
              tool: string,
            ) => {
              const config = getConfig();
              await handleMCPCallTool(config, tool, options.args);
            },
          ),
      ),
  );

root.parse().then(() => {
  exit(0);
});
