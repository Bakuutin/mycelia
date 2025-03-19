import { Command } from "@cliffy/command";
import { generateApiKey } from "@/lib/auth/tokens.ts";
import { ensureDbConnected } from "@/lib/mongo/core.ts";
import { exit } from "node:process";

await ensureDbConnected();

const root = new Command()
  .name("mycelia")
  .command('token', new Command()
    .description("Manage tokens.")
    .command("create", new Command()
      .description("Create a new token.")
      .option("-o, --owner <owner:string>", "The owner of the token.", { default: "admin" })
      .option("-n, --name <name:string>", "The name of the token.", { default: `test_${Math.floor(Date.now() / 1000)}` })
      .action(async ({ owner, name}) => {
        console.log(`Owner: ${owner}`);
        console.log(`Name: ${name}`);
        console.log("Generating token...");
        const key = await generateApiKey(owner, name, []);
        console.log(`Token: ${key}`);
        exit(0);
      })
    )
  );


await root.parse();