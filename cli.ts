import { exit } from "node:process";
import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import process from "node:process";
import { handleLogin } from "./cli/auth.ts";
import { handleAudioImport, handleMicrophoneStream } from "./cli/audio.ts";
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
      )
      .command(
        "microphone",
        new Command()
          .description("Record and stream microphone audio")
          .option(
            "-d, --duration <duration>",
            "Recording duration in seconds (optional, defaults to manual stop)",
          )
          .option(
            "-m, --metadata <metadata>",
            "Additional metadata as JSON string",
          )
          .option(
            "--device <device>",
            "Audio input device (use 'list' to see available devices, or device name/index)",
          )
          .action(
            async (
              options: {
                duration?: string;
                metadata?: string;
                device?: string;
              },
            ) => {
              const config = getConfig();
              const duration = options.duration
                ? parseInt(options.duration)
                : undefined;
              await handleMicrophoneStream(
                config,
                duration,
                options.metadata,
                options.device,
              );
            },
          ),
      ),
  );

root.parse().then(() => {
  exit(0);
});
