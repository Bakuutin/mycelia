import "@/lib/telemetry.ts";
import yargs, { type ArgumentsCamelCase, type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { generateApiKey, verifyApiKey } from "@/lib/auth/tokens.ts";
import process, { exit } from "node:process";
import { verifyToken } from "@/lib/auth/core.server.ts";
import { type Policy } from "@/lib/auth/resources.ts";
import express from "express";
import morgan from "morgan";
import type { Request, Response } from "express";
import { createInterface } from "node:readline/promises";
import cors from "npm:cors@2.8.5";
import { createServer as createHttpServer } from "node:http";
import { WebSocketServer } from "npm:ws@^8.18.0";

import { requestCounter } from "@/lib/telemetry.ts";
import { handlePcmWebSocket } from "@/services/audio.websocket.server.ts";
import { setupResources } from "@/lib/resources/registry.ts";
import { shutdownTelemetry } from "@/lib/telemetry.ts";
import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";
import { registerRoutes } from "./routes.ts";
import { errorHandler } from "@/middleware/errorHandler.ts";

let logFile: Deno.FsFile | null = null;

function setupLogging() {
  try {
    logFile = Deno.openSync("server.log", {
      create: true,
      write: true,
      append: true,
    });
    const originalLog = console.log;
    const originalError = console.error;

    const writeToLog = (args: any[], isError = false) => {
      const timestamp = new Date().toISOString();
      const message = args.map((arg) => {
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(" ");

      const logLine = `[${timestamp}] ${
        isError ? "ERROR" : "INFO"
      }: ${message}\n`;

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
  await setupResources();
  await ensureAllCollectionsExist();
}

async function startServer(host: string, port: number) {
  await setupResources();

  const app = express();
  const httpServer = createHttpServer(app);

  app.disable("x-powered-by");
  app.use(cors());
  app.use(morgan("tiny"));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.use((req: Request, _res: Response, next: () => void) => {
    requestCounter.add(1, {
      method: req.method,
      route: new URL(req.url || "/", "http://localhost").pathname,
    });
    next();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/ws_pcm") {
      wss.handleUpgrade(request, socket, head, (ws: any) => {
        handlePcmWebSocket(ws, request).catch((error) => {
          console.error("WebSocket error:", error);
          if (ws.readyState === 1) {
            ws.close(1011, "Internal server error");
          }
        });
      });
    } else {
      socket.destroy();
    }
  });

  app.use((req: Request, _res: Response, next: () => void) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    next();
  });

  // Register all routes
  registerRoutes(app);

  // Error handling middleware (must be last)
  app.use(errorHandler);

  httpServer.listen(port, host, () => {
    console.log(`Server is running on ${host}:${port}`);
    console.log(`Open http://${host}:${port}`);
  });

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, async () => {
      console.log(`Received shutdown signal: ${signal}`);
      httpServer?.close(console.error);
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
          }),
      async (
        args: ArgumentsCamelCase<{ host: string; port: number }>,
      ) => {
        try {
          const host = String(args.host);
          const port = Number(args.port);
          await startServer(host, port);
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
        console.log(`MYCELIA_TOKEN=${key}`);
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
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });
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
