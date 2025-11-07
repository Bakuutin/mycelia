import "@/lib/telemetry.ts";
import yargs, { type ArgumentsCamelCase, type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { generateApiKey, verifyApiKey } from "@/lib/auth/tokens.ts";
import process, { exit } from "node:process";
import { verifyToken } from "@/lib/auth/core.server.ts";
import { type Policy } from "@/lib/auth/resources.ts";
import { createServer } from "vite";
import express from "express";
import morgan from "morgan";
import type { Request, Response } from "express";
import { createInterface } from "node:readline/promises";
import cors from "npm:cors@2.8.5";
import { createServer as createHttpServer } from "node:http";
import { WebSocketServer } from "npm:ws@^8.18.0";

import { type ServerBuild } from "@remix-run/node";
import { createRequestHandler } from "@remix-run/express";

import { requestCounter } from "@/lib/telemetry.ts";
import { spawnAudioProcessingWorker } from "@/services/audio.server.ts";
import { handlePcmWebSocket } from "@/services/audio.websocket.server.ts";
import path from "node:path";
import { setupResources } from "@/lib/resources/registry.ts";
import { shutdownTelemetry } from "@/lib/telemetry.ts";
import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";
import { pathToFileURL } from "node:url";

async function setup() {
  await setupResources();
  await ensureAllCollectionsExist();
}

async function startServer(host: string, port: number, isProduction: boolean) {
  const app = express();
  const httpServer = createHttpServer(app);

  app.disable("x-powered-by");
  app.use(cors());
  app.use(morgan("tiny"));

  app.use((req: Request, _res: Response, next: () => void) => {
    requestCounter.add(1, {
      method: req.method,
      route: new URL(req.url, "http://localhost").pathname,
    });
    next();
  });

  const wss = new WebSocketServer({ noServer: true });
  let viteServer: Awaited<ReturnType<typeof createServer>> | null = null;

  if (!isProduction) {
    viteServer = await createServer({
      configFile: "vite.config.ts",
      mode: "development",
      server: {
        middlewareMode: true,
      },
    });
  }

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
    } else if (!isProduction && viteServer) {
      const viteWsServer = (viteServer as any).ws;
      if (viteWsServer && typeof viteWsServer.handleUpgrade === "function") {
        viteWsServer.handleUpgrade(request, socket, head, (ws: any) => {
          viteWsServer.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    } else {
      socket.destroy();
    }
  });

  app.use((req: Request, _res: Response, next: () => void) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    next();
  });

  if (isProduction) {
    const serverBuildPath = path.resolve("./build/server/index.js");
    const clientAssetsDir = path.resolve("./build/client");
    console.log(`Loading server build from ${serverBuildPath}`);
    const build: ServerBuild = await import(
      pathToFileURL(serverBuildPath).href
    );

    console.log(
      `Serving static assets from ${clientAssetsDir} at ${build.publicPath}`,
    );
    app.use(
      build.publicPath,
      express.static(clientAssetsDir, {
        immutable: true,
        maxAge: "1y",
      }),
    );
    app.use(express.static("public", { maxAge: "1h" }));

    app.all(
      "*",
      createRequestHandler({ build, mode: "production" }),
    );
  } else {
    app.use(express.static("public", { maxAge: "1h" }));

    app.use(viteServer!.middlewares);

    app.all("*", async (req: Request, res: Response, next: () => void) => {
      try {
        const serverBuildModule = await viteServer!.ssrLoadModule(
          "virtual:remix/server-build",
        );
        const build = serverBuildModule.default ||
          serverBuildModule as ServerBuild;
        return createRequestHandler({ build, mode: "development" })(
          req,
          res,
          next,
        );
      } catch (error) {
        console.error("Error loading Remix build:", error);
        next();
      }
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
    console.error("Unhandled error:", err);
    res.status(500).send("Internal Server Error");
  });

  httpServer.listen(port, host, () => {
    console.log(
      `Server is running on ${host}:${port} (${
        isProduction ? "production" : "development"
      })`,
    );
    console.log(`Open http://${host}:${port}`);
  });

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, async () => {
      console.log(`Received shutdown signal: ${signal}`);
      httpServer?.close(console.error);
      await shutdownTelemetry();
    });
  });
}

async function configureCli() {
  await yargs(hideBin(process.argv))
    .scriptName("deno run -A --env server.ts")
    .usage("$0 <command> [options]")
    .command(
      "audio worker",
      "Start the audio processing worker.",
      (y: Argv) => y,
      async () => {
        console.log("Starting audio processing worker...");
        await spawnAudioProcessingWorker();
        console.log("Audio processing worker started successfully!");
        await new Promise(() => {});
      },
    )
    .command(
      "serve",
      "Start the development server.",
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
      async (
        args: ArgumentsCamelCase<{ host: string; port: number; prod: boolean }>,
      ) => {
        try {
          const host = String(args.host);
          const port = Number(args.port);
          await startServer(host, port, args.prod);
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
      "token create",
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
      "token validate",
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
  await setup();
  await configureCli();
  exit(0);
}

main();
