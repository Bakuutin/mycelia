import { Command } from "@cliffy/command";
import { Secret } from "@cliffy/prompt";
import { CompletionsCommand } from "@cliffy/command/completions";
import { generateApiKey, verifyApiKey } from "@/lib/auth/tokens.ts";
import { ensureDbConnected } from "@/lib/mongo/core.server.ts";
import process, { exit } from "node:process";
import { Policy, verifyToken } from "@/lib/auth/core.server.ts";
import { createServer } from "npm:vite";
import express from "npm:express";
import morgan from "npm:morgan";

import { type ServerBuild } from "@remix-run/node";
import { createRequestHandler } from "@remix-run/express";

import { findAndImportFiles } from "@/lib/importers/main.ts";
import { updateAllHistogram } from "@/services/timeline.server.ts";
import { spawnAudioProcessingWorker } from "@/services/audio.server.ts";
import ms from "ms";
import path from "node:path";

function parseDateOrRelativeTime(expr: string | undefined): Date | undefined {
  if (!expr) return undefined;
  try {
    // Try parsing as a relative time first
    const relativeMs = ms(expr);
    if (relativeMs) {
      return new Date(Date.now() - relativeMs);
    }
    // If not a relative time, try parsing as an absolute date
    return new Date(expr);
  } catch {
    throw new Error(
      `Invalid time expression: ${expr}. Use format like "5d" or "10m" or an ISO date`,
    );
  }
}

await ensureDbConnected();

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
    "timeline",
    new Command()
      .description("Manage timeline data.")
      .command(
        "recalculate",
        new Command()
          .description("Update histogram resolutions.")
          .option("-a, --all", "Update all resolutions", { default: false })
          .arguments("[start:string] [end:string]")
          .action(async ({ all }, start, end) => {
            console.log("Updating histograms...");
            if (all) {
              await updateAllHistogram();
            } else {
              const startDate = parseDateOrRelativeTime(start);
              const endDate = end ? parseDateOrRelativeTime(end) : new Date();
              await updateAllHistogram(startDate, endDate);
            }
            console.log("Histogram update complete!");
          }),
      ),
  )
  .command(
    "importers",
    new Command()
      .description("Manage importers.")
      .command(
        "run",
        new Command()
          .description("Scan fs for new files to import.")
          .action(async () => {
            await findAndImportFiles();
          }),
      ),
  )
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

            // Keep the process running
            await new Promise(() => {
              // This promise never resolves, keeping the worker alive
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
      .action(async ({ port, host, prod }) => {
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
