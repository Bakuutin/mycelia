import { exit } from "node:process";
import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import { handleLogin } from "./cli/auth.ts";
import { handleMCPCallTool, handleMCPListTools } from "./cli/mcp.ts";
import {
  handleLLMAdd,
  handleLLMList,
  handleLLMOllamaSetup,
  handleLLMRemove,
  handleLLMTest,
} from "./cli/llm.ts";
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
  )
  .command(
    "llm",
    new Command()
      .description("LLM model management commands")
      .command(
        "list",
        new Command()
          .description("List configured LLM models")
          .action(async () => {
            const config = getConfig();
            await handleLLMList(config);
          }),
      )
      .command(
        "add",
        new Command()
          .description("Add a new LLM model")
          .option("--alias <alias:string>", "Model alias (e.g., small, medium, large)", {
            required: true,
          })
          .option("--name <name:string>", "Model name (e.g., qwen2.5:7b)", {
            required: true,
          })
          .option("--provider <provider:string>", "Provider (e.g., ollama, openai)", {
            required: true,
          })
          .option("--base-url <baseUrl:string>", "API base URL", {
            required: true,
          })
          .option("--api-key <apiKey:string>", "API key (use 'ollama' for Ollama)", {
            required: true,
          })
          .action(
            async (options: {
              alias: string;
              name: string;
              provider: string;
              baseUrl: string;
              apiKey: string;
            }) => {
              const config = getConfig();
              await handleLLMAdd(config, options);
            },
          ),
      )
      .command(
        "remove",
        new Command()
          .description("Remove an LLM model")
          .arguments("<alias:string>")
          .action(async (_options: unknown, alias: string) => {
            const config = getConfig();
            await handleLLMRemove(config, alias);
          }),
      )
      .command(
        "test",
        new Command()
          .description("Test an LLM model")
          .arguments("<alias:string>")
          .action(async (_options: unknown, alias: string) => {
            const config = getConfig();
            await handleLLMTest(config, alias);
          }),
      )
      .command(
        "ollama-setup",
        new Command()
          .description("Quick setup for remote Ollama server")
          .arguments("<server-url:string>")
          .option(
            "--models <models:string>",
            "Comma-separated list of models (default: qwen2.5:7b)",
          )
          .action(
            async (
              options: { models?: string },
              serverUrl: string,
            ) => {
              const config = getConfig();
              await handleLLMOllamaSetup(config, serverUrl, options);
            },
          ),
      ),
  );

root.parse().then(() => {
  exit(0);
});
