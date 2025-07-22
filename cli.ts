import { exit } from "node:process";
import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import process from "node:process";
import { handleLogin } from "./cli/auth.ts";
import { handleAudioImport } from "./cli/audio.ts";
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
    "audio",
    new Command()
      .description("Audio commands")
      .command(
        "import",
        new Command()
          .description("Import a single audio file.")
          .arguments("<file:string>")
          .option(
            "-s, --start <start>",
            "Start time (ISO date or relative like '5d', '10m')",
          )
          .option(
            "-m, --metadata <metadata>",
            "Additional metadata as JSON string",
          )
          .action(
            async (
              options: { start?: string; metadata?: string },
              file: string,
            ) => {
              const config = getConfig();
              await handleAudioImport(
                config,
                file,
                options.start,
                options.metadata,
              );
            },
          ),
      ),
  );

root.parse().then(() => {
  exit(0);
});
