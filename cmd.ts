import { Command } from "@cliffy/command";
import { Secret } from "@cliffy/prompt";
import { generateApiKey, verifyApiKey } from "@/lib/auth/tokens.ts";
import { ensureDbConnected } from "./app/lib/mongo/core.server.ts";
import { exit } from "node:process";
import { verifyToken } from "./app/lib/auth/core.server.ts";

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
    .command("validate", new Command()
      .description("Validate a token.")
      .action(async () => {
        const token = await Secret.prompt("Enter the token: ");
        if (token.startsWith("mycelia_")) {
          const doc = await verifyApiKey(token);
          if (!doc) {
            console.log("Invalid token");
            exit(1);
          }
          console.log("Token is valid");
          console.log(`Owner: ${doc.owner}`);
          console.log(`Name: ${doc.name}`);
          console.log(`Policies: ${JSON.stringify(doc.policies)}`);  
          console.log(`Created at: ${doc.createdAt}`);
        } else {
          // assume it's a JWT
          const doc = await verifyToken(token);
          if (!doc) {
            console.log("Invalid token");
            exit(1);
          }
          console.log("Token is valid");
          console.log(JSON.stringify(doc, null, 2));
        }
        exit(0);
      })
    )
  );


await root.parse();