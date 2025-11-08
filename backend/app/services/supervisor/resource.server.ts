import { Buffer } from "node:buffer";
import { z } from "zod";
import { Resource, ResourcePath } from "@/lib/auth/resources.ts";
import type { Auth } from "@/lib/auth/core.server.ts";
import { daemonManager } from "./manager.server.ts";
import { dockerClient } from "./docker.server.ts";
import { daemonManifestSchema } from "./core.ts";
import type { DaemonManifest, DaemonStatus } from "./core.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

// Request schemas
const listSchema = z.object({
  action: z.literal("list"),
});

const installSchema = z.object({
  action: z.literal("install"),
  manifest: daemonManifestSchema.omit({
    _id: true,
    installedAt: true,
    installedBy: true,
    targetState: true,
    lastError: true,
  }),
});

const startSchema = z.object({
  action: z.literal("start"),
  name: z.string(),
});

const stopSchema = z.object({
  action: z.literal("stop"),
  name: z.string(),
});

const removeSchema = z.object({
  action: z.literal("remove"),
  name: z.string(),
});

const statusSchema = z.object({
  action: z.literal("status"),
  name: z.string(),
});

const logsSchema = z.object({
  action: z.literal("logs"),
  name: z.string(),
  tail: z.number().optional(),
  follow: z.boolean().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
});

const daemonRequestSchema = z.discriminatedUnion("action", [
  listSchema,
  installSchema,
  startSchema,
  stopSchema,
  removeSchema,
  statusSchema,
  logsSchema,
]);

export type DaemonRequest = z.infer<typeof daemonRequestSchema>;
export type DaemonResponse = any;

// Action mapping for extractActions
const actionMap: Record<DaemonRequest["action"], string[]> = {
  list: ["read"],
  install: ["write"],
  start: ["write"],
  stop: ["write"],
  remove: ["delete"],
  status: ["read"],
  logs: ["read"],
};

export class DaemonResource implements Resource<DaemonRequest, DaemonResponse> {
  code = "tech.mycelia.daemon";
  description = "Manage Docker daemon containers";

  schemas = {
    request: daemonRequestSchema,
    response: z.any(),
  };

  extractActions(input: DaemonRequest): Array<{ path: ResourcePath; actions: string[] }> {
    const actions = actionMap[input.action] || [];

    if ("name" in input) {
      return [{
        path: ["daemon", input.name],
        actions,
      }];
    }

    // For list action, use wildcard path
    return [{
      path: ["daemon", "*"],
      actions,
    }];
  }

  async use(input: DaemonRequest, auth: Auth): Promise<DaemonResponse> {
    switch (input.action) {
      case "list": {
        const daemons = await daemonManager.list(auth);
        return daemons;
      }

      case "install": {
        const manifest: DaemonManifest = {
          ...input.manifest,
          installedAt: new Date(),
          installedBy: auth.principal,
          targetState: "installed",
        };
        await daemonManager.install(manifest, auth);
        return { success: true, name: manifest.name };
      }

      case "start": {
        await daemonManager.start(input.name, auth);
        return { success: true, name: input.name };
      }

      case "stop": {
        await daemonManager.stop(input.name, auth);
        return { success: true, name: input.name };
      }

      case "remove": {
        await daemonManager.remove(input.name, auth);
        return { success: true, name: input.name };
      }

      case "status": {
        const status = await daemonManager.getStatus(input.name, auth);
        return status;
      }

      case "logs": {
        // Load manifest to get _id for container name
        const mongo = await getMongoResource(auth);
        const manifest = await mongo({
          action: "findOne",
          collection: "daemons",
          query: { name: input.name },
        }) as DaemonManifest | null;

        if (!manifest || !manifest._id) {
          throw new Error(`Daemon ${input.name} not found`);
        }

        const containerName = manifest._id.toString();
        const container = await dockerClient.getContainer(containerName);
        if (!container) {
          throw new Error(`Container ${containerName} not found`);
        }

        // For now, return logs as a stream that can be read
        // In the future, this could support WebSocket streaming
        const logStream = await dockerClient.getContainerLogs(container, {
          tail: input.tail,
          since: input.since,
          until: input.until,
          follow: input.follow,
        });

        // Convert stream to string array for now
        // TODO: Support streaming responses via WebSocket
        if (input.follow) {
          // For follow mode, we'd need to return a streaming response
          // This is a simplified version - in production, use WebSocket or SSE
          throw new Error("Follow mode not yet implemented - use tail instead");
        }

        // Read all logs into buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of logStream) {
          if (chunk instanceof Uint8Array) {
            chunks.push(chunk);
          } else if (typeof chunk === "string") {
            chunks.push(new TextEncoder().encode(chunk));
          } else {
            chunks.push(new Uint8Array(chunk));
          }
        }

        // Docker logs are in a special format with headers
        // Parse them to extract just the log lines
        const buffer = Buffer.concat(chunks);
        const lines: string[] = [];
        let offset = 0;

        while (offset < buffer.length) {
          if (offset + 8 > buffer.length) break;

          // Docker log format: [8-byte header][payload]
          // Header: [stream type (1 byte)][reserved (3 bytes)][size (4 bytes)]
          const streamType = buffer[offset];
          const size = buffer.readUInt32BE(offset + 4);

          offset += 8;

          if (offset + size > buffer.length) break;

          const payload = buffer.subarray(offset, offset + size);
          const line = payload.toString("utf-8").trim();

          if (line) {
            lines.push(line);
          }

          offset += size;
        }

        const status = await dockerClient.getContainerStatus(containerName);
        return {
          logs: lines,
          containerId: status?.id || null,
        };
      }

      default:
        throw new Error(`Unknown action: ${(input as any).action}`);
    }
  }
}

