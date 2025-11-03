import "@/lib/telemetry.ts";
import yargs, { type Argv, type ArgumentsCamelCase } from 'yargs';
import { hideBin } from 'yargs/helpers';
import { generateApiKey, verifyApiKey } from "@/lib/auth/tokens.ts";
import process, { exit } from "node:process";
import { verifyToken } from "@/lib/auth/core.server.ts";
import { type Policy } from "@/lib/auth/resources.ts";
import { createServer } from "vite";
import express from "express";
import morgan from "morgan";
import type { Request, Response } from "express";
import { createInterface } from "node:readline/promises";

import { type ServerBuild } from "@remix-run/node";
import { createRequestHandler } from "@remix-run/express";

import { requestCounter } from "@/lib/telemetry.ts";
import { spawnAudioProcessingWorker } from "@/services/audio.server.ts";
import path from "node:path";
import { setupResources } from "@/lib/resources/registry.ts";
import { shutdownTelemetry } from "@/lib/telemetry.ts";
import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";
import { pathToFileURL } from "node:url";
import { load } from "@std/dotenv";

let logFile: Deno.FsFile | null = null;

function setupLogging() {
  try {
    logFile = Deno.openSync("server.log", { create: true, write: true, append: true });
    const originalLog = console.log;
    const originalError = console.error;

    const writeToLog = (args: any[], isError = false) => {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');

      const logLine = `[${timestamp}] ${isError ? 'ERROR' : 'INFO'}: ${message}\n`;

      try {
        originalLog(...args);
        if (logFile) {
          logFile.writeSync(new TextEncoder().encode(logLine));
          logFile.syncDataSync();
        }
      } catch (e) {
        originalError("Failed to write to log file:", e);
      }
    };

    console.log = (...args: any[]) => writeToLog(args, false);
    console.error = (...args: any[]) => writeToLog(args, true);

    console.log("Logging initialized - logs will be written to server.log");
  } catch (error) {
    console.error("Failed to setup logging:", error);
  }
}

function cleanupLogging() {
  if (logFile) {
    logFile.close();
    logFile = null;
  }
}

async function setup() {
  await load({ envPath: ".env", export: true });
  await setupResources();
  await ensureAllCollectionsExist();
}

function cors() {
  return (req: Request, res: Response, next: () => void) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }
    next();
  };
}

async function startProdServer(host: string, port: number) {
  const app = express();
  const serverBuildPath = path.resolve("./build/server/index.js");
  const clientAssetsDir = path.resolve("./build/client");
  console.log(`Loading server build from ${serverBuildPath}`);
  const build: ServerBuild = await import(pathToFileURL(serverBuildPath).href);
  app.disable("x-powered-by");
  app.use(cors());
  console.log(`Serving static assets from ${clientAssetsDir} at ${build.publicPath}`);
  app.use(
    build.publicPath,
    express.static(clientAssetsDir, {
      immutable: true,
      maxAge: "1y",
    }),
  );
  app.use(express.static("public", { maxAge: "1h" }));
  app.use(morgan("tiny"));

  app.use((req: Request, _res: Response, next: () => void) => {
    requestCounter.add(1, {
      method: req.method,
      route: new URL(req.url, "http://localhost").pathname,
    });
    next();
  });

  app.use((req: Request, _res: Response, next: () => void) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    next();
  });

  app.all(
    "*",
    createRequestHandler({ build, mode: "production" }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
    console.error("Unhandled error:", err);
    res.status(500).send("Internal Server Error");
  });

  const server = app.listen(port, host, () => {
    console.log(`Server is running on ${host}:${port}`);
    console.log(`Open http://${host}:${port}`);
  });

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, async () => {
      console.log(`Received shutdown signal: ${signal}`);
      server?.close(console.error);
      await shutdownTelemetry();
      cleanupLogging();
    });
  });
}

async function startDevServer(host: string, port: number) {
  const server = await createServer({
    configFile: "vite.config.ts",
    mode: "development",
    server: {
      host,
      port,
    },
  });

  server.middlewares.use(cors());

  await server.listen();

  console.log(`Server is running on ${host}:${port}`);
  console.log(`Open http://${host}:${port}`);

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, async () => {
      console.log(`Received shutdown signal: ${signal}`);
      server?.close();
      await shutdownTelemetry();
      cleanupLogging();
    });
  });
}

async function configureCli() {
  await yargs(hideBin(process.argv))
    .scriptName("deno run -A --env server.ts")
    .usage("$0 <command> [options]")
    .command(
      "serve",
      "Start web server.",
      (y: Argv) =>
        y
          .option("port", {
            alias: "p",
            type: "number",
            describe: "Port to serve on.",
            default: 5173,
          })
          .option("host", {
            alias: "h",
            type: "string",
            describe: "Host to serve on.",
            default: "0.0.0.0",
          })
          .option("prod", {
            type: "boolean",
            describe: "Serve in production mode",
            default: false,
          }),
      async (args: ArgumentsCamelCase<{ host: string; port: number; prod: boolean }>) => {
        try {
          const host = String(args.host);
          const port = Number(args.port);
          if (args.prod) {
            await startProdServer(host, port);
          } else {
            await startDevServer(host, port);
          }
          await new Promise((resolve) => {
            process.on("SIGINT", resolve);
            process.on("SIGTERM", resolve);
          });
        } catch (err) {
          console.error("Failed to start server:", err);
          exit(1);
        }
      },
    )
    .command(
      "token-create",
      "Create a new token.",
      (y: Argv) =>
        y
          .option("owner", {
            alias: "o",
            type: "string",
            describe: "The owner of the token.",
            default: "admin",
          })
          .option("name", {
            alias: "n",
            type: "string",
            describe: "The name of the token.",
            default: `test_${Math.floor(Date.now() / 1000)}`,
          }),
      async (args: ArgumentsCamelCase<{ owner: string; name: string }>) => {
        const owner = String(args.owner);
        const name = String(args.name);
        console.log(`Owner: ${owner}`);
        console.log(`Name: ${name}`);
        console.log("Generating token...");
        const key = await generateApiKey(owner, name, [
          { resource: "**", action: "**", effect: "allow" } as Policy,
        ]);
        console.log(`MYCELIA_TOKEN: ${key}`);
      },
    )
    .command(
      "token-validate",
      "Validate a token.",
      (y: Argv) =>
        y.option("token", {
          type: "string",
          describe: "Token to validate",
        }),
      async (args: ArgumentsCamelCase<{ token?: string }>) => {
        let token = args.token as string | undefined;
        if (!token) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          token = await rl.question("Enter the token: ");
          await rl.close();
        }
        if (!token) {
          console.log("Invalid token");
          exit(1);
        }
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
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}

async function main() {
  setupLogging();
  await setup();
  await configureCli();
  cleanupLogging();
  exit(0);
}

main();
