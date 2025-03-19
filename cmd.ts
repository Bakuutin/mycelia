import { Command, EnumType } from "@cliffy/command";
import { c } from "npm:vite@^5.1.0";

const logLevelType = new EnumType(["debug", "info", "warn", "error"]);

interface Options {
  debug?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
}

const root = new Command()
  .name("mycelia")
  .type("log-level", logLevelType)
  .env("DEBUG=<enable:boolean>", "Enable debug output.")
  .option("-d, --debug", "Enable debug output.")
  .option("-l, --log-level <level:log-level>", "Set log level.", {
    default: "info",
  })
  .command('token', new Command()
    .description("Manage tokens.")
    .command("create", new Command()
      .description("Create a new token.")
      .action(async (options: Options) => {
        console.log("Create token", options);
      })
    )
  );


await root.parse();