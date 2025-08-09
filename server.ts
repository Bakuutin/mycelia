import { Command } from "@cliffy/command";
import { Secret } from "@cliffy/prompt";
import { CompletionsCommand } from "@cliffy/command/completions";
import { generateApiKey, verifyApiKey } from "@/lib/auth/tokens.ts";
import process, { exit } from "node:process";
import { verifyToken } from "@/lib/auth/core.server.ts";
import { type Policy } from "@/lib/auth/resources.ts";
import { createServer } from "npm:vite";
import express from "npm:express";
import morgan from "npm:morgan";

import { type ServerBuild } from "@remix-run/node";
import { createRequestHandler } from "@remix-run/express";

import { spawnAudioProcessingWorker } from "@/services/audio.server.ts";
import path from "node:path";
import {
  setupResources,
} from "@/lib/resources/registry.ts";

async function setup() {
  // Load resources from configuration
  // You can specify a custom config path via MYCELIA_RESOURCE_CONFIG env var
  const configPath = Deno.env.get("MYCELIA_RESOURCE_CONFIG");
  await setupResources(configPath);
}


async function startProdServer() {
  const app = express();
  const buildPath = path.resolve("./build/server/index.js");
  const build: ServerBuild = await import(buildPath);
  app.disable("x-powered-by");
  console.log(build.publicPath);
  console.log(build.assetsBuildDirectory);
  app.use(
    build.publicPath,
    express.static(build.assetsBuildDirectory, {
      immutable: true,
      maxAge: "1y",
    }),
  );
  app.use(express.static("public", { maxAge: "1h" }));
  app.use(morgan("tiny"));

  app.all(
    "*",
    createRequestHandler({ build, mode: "production" }),
  );

  const server = app.listen(3000, () => {
    console.log("Server is running on port 3000");
  });

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, () => server?.close(console.error));
  });
}

async function startDevServer() {
  const server = await createServer({
    configFile: "vite.config.ts",
    mode: "development",
  });

  await server.listen(5173);

  console.log("Server is running on port 5173");

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, () => server?.close());
  });
}

const root = new Command()
  .name("deno run -A --env cmd.ts")
  .action(() => {
    console.log(root.getHelp());
  })
  .command("completions", new CompletionsCommand())
  .command(
    "audio",
    new Command()
      .description("Manage audio processing.")
      .command(
        "worker",
        new Command()
          .description("Start the audio processing worker.")
          .action(async () => {
            console.log("Starting audio processing worker...");
            await spawnAudioProcessingWorker();
            console.log("Audio processing worker started successfully!");

            await new Promise(() => {
            });
          }),
      ),
  )
  .command(
    "serve",
    new Command()
      .description("Start the development server.")
      .option("-p, --port <port:number>", "Port to serve on.", {
        default: 5173,
      })
      .option("-h, --host <host:string>", "Host to serve on.", {
        default: "0.0.0.0",
      })
      .option("--prod", "Serve in production mode", { default: false })
      .action(async ({ prod }) => {
        try {
          if (prod) {
            await startProdServer();
          } else {
            await startDevServer();
          }
          await new Promise((resolve) => {
            process.on("SIGINT", resolve);
            process.on("SIGTERM", resolve);
          });
        } catch (err) {
          console.error("Failed to start server:", err);
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
                "effect": "allow",
              } as Policy,
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

async function main() {
  await setup();
  await root.parse();
  exit(0);
}

main();
