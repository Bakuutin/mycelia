import { Command } from "@cliffy/command";
import { Secret } from "@cliffy/prompt";
import { CompletionsCommand } from "@cliffy/command/completions";
import { generateApiKey, verifyApiKey } from "@/lib/auth/tokens.ts";
import { ensureDbConnected } from "@/lib/mongo/core.server.ts";
import process, { exit } from "node:process";
import { Policy, verifyToken } from "@/lib/auth/core.server.ts";
import { createServer, build } from 'vite';

await ensureDbConnected();

const root = new Command()
  .name("deno run -A --env cmd.ts")
  .action(() => {
    console.log(root.getHelp());
  })
  .command("completions", new CompletionsCommand())
  .command(
    "serve",
    new Command()
      .description("Start the development server.")
      .option("-p, --port <port:number>", "Port to serve on.", { default: 5173 })
      .option("-h, --host <host:string>", "Host to serve on.", { default: "0.0.0.0" })
      .option("--prod", "Serve in production mode", { default: false })
      .action(async ({ port, host, prod }) => {
        try {
          if (prod) {
            console.log('Building for production...');
            await build({
              configFile: 'vite.config.ts',
              mode: 'production',
            });
            console.log('Build complete!');
          }

          const server = await createServer({
            configFile: 'vite.config.ts',
            mode: prod ? 'production' : 'development',
            server: {
              port,
              host,
            },
          });
        
          await server.listen();
        
          console.log(`${prod ? 'Production' : 'Development'} server running at:`, server.resolvedUrls?.local?.[0] || 'unknown');

          await new Promise((resolve) => {
            process.on('SIGINT', resolve);
            process.on('SIGTERM', resolve);
          });

          await server.close();
        } catch (err) {
          console.error('Failed to start server:', err);
          exit(1);
        }
      }),
  )
  .command(
    "token",
    new Command()
      .description("Manage tokens.")
      .command(
        "create",
        new Command()
          .description("Create a new token.")
          .option("-o, --owner <owner:string>", "The owner of the token.", {
            default: "admin",
          })
          .option("-n, --name <name:string>", "The name of the token.", {
            default: `test_${Math.floor(Date.now() / 1000)}`,
          })
          .action(async ({ owner, name }) => {
            console.log(`Owner: ${owner}`);
            console.log(`Name: ${name}`);
            console.log("Generating token...");
            const key = await generateApiKey(owner, name, [
              {
                "resource": "*",
                "action": "*",
                "effect": "allow"
              } as Policy
            ]);
            console.log(`Token: ${key}`);
          }),
      )
      .command(
        "validate",
        new Command()
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
          }),
      ),
  );


root.parse().then(() => {
  exit(0);
});
