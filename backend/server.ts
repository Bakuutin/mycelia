import { load as loadEnv } from "@std/dotenv";
import { existsSync } from "@std/fs/exists";


if (existsSync(".env")) {
  await loadEnv({ envPath:  ".env", export: true });
}

if (existsSync("../.env")) {
  await loadEnv({ envPath:  "../.env", export: true });
}


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
import { handleUpdatesWebSocket } from "@/services/updates.websocket.server.ts";
import { setupResources } from "@/lib/resources/registry.ts";
import { shutdownTelemetry } from "@/lib/telemetry.ts";
import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";
import { registerRoutes } from "./routes.ts";
import { errorHandler } from "@/middleware/errorHandler.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { startWorkers, stopWorkers } from "@/lib/jobs/workers.ts";
import { maintenanceManager } from "@/lib/jobs/maintenance-manager.ts";
import { startChangeStreamWorker, stopChangeStreamWorker } from "@/lib/mongo/changeStream.worker.ts";
import { startAccessLogWorker, stopAccessLogWorker } from "@/lib/auth/accessLog.worker.ts";
import { triggerManager } from "@/lib/jobs/trigger-manager.ts";
import { up, down, to, status } from "@/lib/mongo/migrator.ts";
import { JobsResource } from "@/lib/resources/worker.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";


let logFile: Deno.FsFile | null = null;

function setupLogging() {
  const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
  const LOG_FILE_PATH = "server.log";

  try {
    logFile = Deno.openSync(LOG_FILE_PATH, {
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
          try {
            const stats = Deno.statSync(LOG_FILE_PATH);
            if (stats.size > MAX_LOG_SIZE) {
              logFile.close();
              if (existsSync(LOG_FILE_PATH + ".old")) {
                Deno.removeSync(LOG_FILE_PATH + ".old");
              }
              Deno.renameSync(LOG_FILE_PATH, LOG_FILE_PATH + ".old");
              logFile = Deno.openSync(LOG_FILE_PATH, {
                create: true,
                write: true,
                append: true,
              });
            }
          } catch (rotateError) {
            // If rotation fails, we'll just try to continue writing to the current file
            // Re-open if it was closed but rename failed
            if (!logFile) {
              logFile = Deno.openSync(LOG_FILE_PATH, {
                create: true,
                write: true,
                append: true,
              });
            }
          }

          logFile.writeSync(new TextEncoder().encode(logLine));
          logFile.syncDataSync();
        }
      } catch (e) {
        originalError("Failed to write to log file:", e);
      }
    };

    console.log = (...args: any[]) => writeToLog(args, false);
    console.error = (...args: any[]) => writeToLog(args, true);

    console.log(`Logging initialized - logs will be written to ${LOG_FILE_PATH}`);
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

async function startServer(
  host: string,
  port: number,
  skipChecks = false,
  noWorkers = false,
) {
  await setupResources();
  if (!skipChecks) {
    const db = await getRootDB();
    await ensureAllCollectionsExist(db);
  }

  if (!noWorkers) {
    await startWorkers();
    await startChangeStreamWorker();
    await startAccessLogWorker();
    await triggerManager.start();
    await maintenanceManager.start();
  }

  const app = express();
  const httpServer = createHttpServer(app);

  app.disable("x-powered-by");
  app.use(cors({
    exposedHeaders: ["X-Mycelia-Chat-Id"],
  }));
  // HTTP request logging - disable with LOG_HTTP=false
  if (Deno.env.get("LOG_HTTP") !== "false") {
    app.use(morgan("tiny", {
      skip: (req: Request) =>
        req.url === "/health" ||
        req.url === "/readiness" ||
        req.url?.startsWith("/api/resource/"),
    }));
  }
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  app.use((req: Request, _res: Response, next: () => void) => {
    if (req.url !== "/health" && req.url !== "/readiness") {
      requestCounter.add(1, {
        method: req.method,
        route: new URL(req.url || "/", "http://localhost").pathname,
      });
    }
    next();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname === "/ws_pcm") {
      wss.handleUpgrade(request, socket, head, (ws: any) => {
        // Add error handler immediately to catch any errors including broken pipe
        ws.on("error", (error: Error) => {
          // Only log non-trivial errors (broken pipe is expected on disconnect)
          if (!error.message.includes("Broken pipe") && !error.message.includes("EPIPE")) {
            console.error("WebSocket /ws_pcm error:", error);
          }
        });
        
        handlePcmWebSocket(ws, request).catch((error) => {
          console.error("WebSocket /ws_pcm handler error:", error);
          // Try to close, but catch any errors (e.g., if already closed)
          try {
            if (ws.readyState === 1) {
              ws.close(1011, "Internal server error");
            }
          } catch (closeError) {
            // Ignore errors when closing (socket might already be dead)
          }
        });
      });
    } else if (url.pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws: any) => {
        // Add error handler immediately to catch any errors including broken pipe
        ws.on("error", (error: Error) => {
          // Only log non-trivial errors (broken pipe is expected on disconnect)
          if (!error.message.includes("Broken pipe") && !error.message.includes("EPIPE")) {
            console.error("WebSocket /ws error:", error);
          }
        });
        
        handleUpdatesWebSocket(ws, request).catch((error) => {
          console.error("WebSocket /ws handler error:", error);
          // Try to close, but catch any errors (e.g., if already closed)
          try {
            if (ws.readyState === 1) {
              ws.close(1011, "Internal server error");
            }
          } catch (closeError) {
            // Ignore errors when closing (socket might already be dead)
          }
        });
      });
    } else {
      socket.destroy();
    }
  });

  // Request logging - enable with DEBUG_REQUESTS=true
  if (Deno.env.get("DEBUG_REQUESTS") === "true") {
    app.use((req: Request, _res: Response, next: () => void) => {
      if (req.url !== "/health" && req.url !== "/readiness") {
        console.log(`Incoming request: ${req.method} ${req.url}`);
      }
      next();
    });
  }

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
      await stopWorkers();
      await stopAccessLogWorker();
      await stopChangeStreamWorker();
      await triggerManager.stop();
      await maintenanceManager.stop();
      await shutdownTelemetry();
      cleanupLogging();
    });
  });
}

async function configureCli() {
  await yargs(hideBin(process.argv))
    .scriptName("deno run -A server.ts")
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
          .option("skip-checks", {
            type: "boolean",
            describe: "Skip MongoDB collection and index checks.",
            default: false,
          })
          .option("workers", {
            type: "boolean",
            describe: "Start background workers.",
            default: true,
          }),
      async (
        args: ArgumentsCamelCase<{
          host: string;
          port: number;
          skipChecks?: boolean;
          workers?: boolean;
        }>,
      ) => {
        try {
          const host = String(args.host);
          const port = Number(args.port);
          const skipChecks = Boolean(args.skipChecks);
          const noWorkers = !args.workers;
          await startServer(host, port, skipChecks, noWorkers);
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
        await setupResources();
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
    .command(
      "migrate-up",
      "Apply all pending migrations",
      () => {},
      async () => {
        try {
          const db = await getRootDB();
          const client = db.client as any;
          const migrated = await up(db, client);
          if (migrated.length === 0) {
            console.log("No pending migrations");
          } else {
            console.log(`Applied ${migrated.length} migration(s)`);
          }
        } catch (err) {
          console.error("Migration failed:", err);
          exit(1);
        }
      },
    )
    .command(
      "migrate-down",
      "Rollback the last migration(s)",
      (y: Argv) =>
        y.option("count", {
          alias: "n",
          type: "number",
          describe: "Number of migrations to rollback",
          default: 1,
        }),
      async (args: ArgumentsCamelCase<{ count?: number }>) => {
        try {
          const db = await getRootDB();
          const client = db.client as any;
          const count = Number(args.count) || 1;
          const rolledBack = await down(db, client, count);
          if (rolledBack.length === 0) {
            console.log("No migrations to rollback");
          } else {
            console.log(`Rolled back ${rolledBack.length} migration(s)`);
          }
        } catch (err) {
          console.error("Rollback failed:", err);
          exit(1);
        }
      },
    )
    .command(
      "migrate-to",
      "Migrate to a specific migration",
      (y: Argv) =>
        y.option("migration", {
          alias: "m",
          type: "string",
          describe: "Migration file name (e.g., 0002_messengers_setup.ts)",
          demandOption: true,
        }),
      async (args: ArgumentsCamelCase<{ migration: string }>) => {
        try {
          const db = await getRootDB();
          const client = db.client as any;
          const migrationFile = String(args.migration);
          const migrated = await to(db, client, migrationFile);
          if (migrated.length === 0) {
            console.log(`Already at migration ${migrationFile}`);
          } else {
            console.log(`Migrated ${migrated.length} migration(s) to ${migrationFile}`);
          }
        } catch (err) {
          console.error("Migration failed:", err);
          exit(1);
        }
      },
    )
    .command(
      "migrate-status",
      "Show migration status",
      () => {},
      async () => {
        try {
          const db = await getRootDB();
          const migrationStatus = await status(db);
          console.log("\nMigration Status:");
          console.log(`Total migrations: ${migrationStatus.all.length}`);
          console.log(`Applied: ${migrationStatus.applied.length}`);
          console.log(`Pending: ${migrationStatus.pending.length}`);
          
          if (migrationStatus.applied.length > 0) {
            console.log("\nApplied migrations:");
            migrationStatus.applied.forEach((file) => {
              console.log(`  ✓ ${file}`);
            });
          }
          
          if (migrationStatus.pending.length > 0) {
            console.log("\nPending migrations:");
            migrationStatus.pending.forEach((file) => {
              console.log(`  ○ ${file}`);
            });
          }
        } catch (err) {
          console.error("Failed to get migration status:", err);
          exit(1);
        }
      },
    )
    .command(
      "jobs-clear",
      "Clear all completed, failed, and cancelled jobs from database",
      () => {},
      async () => {
        try {
          await setupResources();
          const auth = await getServerAuth();
          const jobsResource = new JobsResource();
          const result = await jobsResource.call({ action: "clear_completed" }, auth);
          console.log(`Deleted ${result.deletedCount} jobs`);
        } catch (err) {
          console.error("Failed to clear jobs:", err);
          exit(1);
        }
      },
    )
    .command(
      "jobs-cancel-all",
      "Cancel all active and waiting jobs",
      () => {},
      async () => {
        try {
          await setupResources();
          const auth = await getServerAuth();
          const jobsResource = new JobsResource();
          await jobsResource.call({ action: "cancel_all" }, auth);
          console.log("All jobs cancelled");
        } catch (err) {
          console.error("Failed to cancel jobs:", err);
          exit(1);
        }
      },
    )
    .command(
      "jobs-pause",
      "Pause all workers",
      () => {},
      async () => {
        try {
          await setupResources();
          const auth = await getServerAuth();
          const jobsResource = new JobsResource();
          await jobsResource.call({ action: "pause_all" }, auth);
          console.log("All workers paused");
        } catch (err) {
          console.error("Failed to pause workers:", err);
          exit(1);
        }
      },
    )
    .command(
      "jobs-resume",
      "Resume all workers",
      () => {},
      async () => {
        try {
          await setupResources();
          const auth = await getServerAuth();
          const jobsResource = new JobsResource();
          await jobsResource.call({ action: "resume_all" }, auth);
          console.log("All workers resumed");
        } catch (err) {
          console.error("Failed to resume workers:", err);
          exit(1);
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
  await configureCli();
  cleanupLogging();
  exit(0);
}

main();
