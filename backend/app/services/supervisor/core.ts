import { z } from "zod";
import { ObjectId } from "mongodb";
import type { Policy } from "@/lib/auth/resources.ts";

export type TargetState = "installed" | "running" | "stopped";

export interface DaemonError {
  message: string;
  timestamp: Date;
  code?: string; // Error code (e.g., "IMAGE_PULL_FAILED", "START_FAILED")
}

export interface DaemonHealthcheck {
  test: string[]; // Health check command
  interval?: number; // Seconds between checks (default: 30)
  timeout?: number; // Seconds before timeout (default: 10)
  retries?: number; // Consecutive failures before unhealthy (default: 3)
  startPeriod?: number; // Seconds to wait before first check (default: 0)
}

export interface DaemonResources {
  memory?: string; // Memory limit (e.g., "512m", "1g", "2Gi")
  cpus?: string; // CPU limit (e.g., "0.5", "2", "1.5")
}

export interface DaemonManifest {
  _id?: ObjectId;
  name: string;
  image: string;
  version?: string;
  description?: string;
  env?: Record<string, string>;
  restart?: "always" | "unless-stopped" | "no";
  healthcheck?: DaemonHealthcheck;
  resources?: DaemonResources;
  policies: Policy[];
  targetState: TargetState;
  installedAt: Date;
  installedBy: string;
  lastError?: DaemonError;
}

export interface ContainerStatus {
  id: string | null;
  state: "running" | "exited" | "created" | "restarting" | "removing" | "paused" | "dead" | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DaemonStatus {
  name: string;
  targetState: TargetState;
  actualState: ContainerStatus | null;
  lastError?: DaemonError;
}

// Zod schemas for validation
export const daemonHealthcheckSchema = z.object({
  test: z.array(z.string()),
  interval: z.number().optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  startPeriod: z.number().optional(),
});

export const daemonResourcesSchema = z.object({
  memory: z.string().optional(),
  cpus: z.string().optional(),
});

export const daemonErrorSchema = z.object({
  message: z.string(),
  timestamp: z.date(),
  code: z.string().optional(),
});

export const daemonManifestSchema = z.object({
  _id: z.instanceof(ObjectId).optional(),
  name: z.string().min(1),
  image: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  restart: z.enum(["always", "unless-stopped", "no"]).optional(),
  healthcheck: daemonHealthcheckSchema.optional(),
  resources: daemonResourcesSchema.optional(),
  policies: z.array(z.any()),
  targetState: z.enum(["installed", "running", "stopped"]),
  installedAt: z.date(),
  installedBy: z.string(),
  lastError: daemonErrorSchema.optional(),
});

