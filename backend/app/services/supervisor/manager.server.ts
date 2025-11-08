import { dockerClient } from "./docker.server.ts";
import type {
  DaemonManifest,
  DaemonError,
  TargetState,
  ContainerStatus,
  DaemonStatus,
} from "./core.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { signJWT } from "@/lib/auth/tokens.ts";
import type { Auth } from "@/lib/auth/core.server.ts";
import { ObjectId } from "mongodb";
import Docker from "npm:dockerode@4.0.9";

const COLLECTION = "daemons";

export class DaemonManager {
  /**
   * Get default environment variables for daemon containers
   */
  private getDefaultEnv(auth: Auth, jwtToken: string): Record<string, string> {
    return {
      MYCELIA_API_URL: Deno.env.get("MYCELIA_API_URL") || "http://localhost:3000",
      MYCELIA_JWT_TOKEN: jwtToken,
    };
  }

  /**
   * Convert healthcheck config to Docker format
   */
  private convertHealthcheck(
    healthcheck?: DaemonManifest["healthcheck"],
  ): Docker.HealthConfig | undefined {
    if (!healthcheck) {
      return undefined;
    }

    return {
      Test: healthcheck.test,
      Interval: healthcheck.interval ? healthcheck.interval * 1_000_000_000 : 30_000_000_000, // Convert to nanoseconds
      Timeout: healthcheck.timeout ? healthcheck.timeout * 1_000_000_000 : 10_000_000_000,
      Retries: healthcheck.retries || 3,
      StartPeriod: healthcheck.startPeriod ? healthcheck.startPeriod * 1_000_000_000 : 0,
    };
  }

  /**
   * Convert resources config to Docker format
   */
  private convertResources(
    resources?: DaemonManifest["resources"],
  ): Docker.Resources | undefined {
    if (!resources) {
      return undefined;
    }

    const dockerResources: Docker.Resources = {};

    if (resources.memory) {
      dockerResources.Memory = this.parseMemory(resources.memory);
    }

    if (resources.cpus) {
      dockerResources.NanoCPUs = Math.floor(parseFloat(resources.cpus) * 1_000_000_000);
    }

    return Object.keys(dockerResources).length > 0 ? dockerResources : undefined;
  }

  /**
   * Parse memory string to bytes
   */
  private parseMemory(memory: string): number {
    const units: Record<string, number> = {
      b: 1,
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024,
    };

    const match = memory.toLowerCase().match(/^(\d+(?:\.\d+)?)([kmg]?i?b?)$/);
    if (!match) {
      throw new Error(`Invalid memory format: ${memory}`);
    }

    const value = parseFloat(match[1]);
    const unit = match[2].replace("i", "").replace("b", "") || "b";
    const multiplier = units[unit] || 1;

    return Math.floor(value * multiplier);
  }

  /**
   * Store error in manifest
   */
  private async storeError(
    auth: Auth,
    id: ObjectId,
    error: DaemonError,
  ): Promise<void> {
    const mongo = await getMongoResource(auth);
    await mongo({
      action: "updateOne",
      collection: COLLECTION,
      query: { _id: id },
      update: { $set: { lastError: error } },
    });
  }

  /**
   * Clear error from manifest
   */
  private async clearError(auth: Auth, id: ObjectId): Promise<void> {
    const mongo = await getMongoResource(auth);
    await mongo({
      action: "updateOne",
      collection: COLLECTION,
      query: { _id: id },
      update: { $unset: { lastError: "" } },
    });
  }

  /**
   * Get container name from daemon ID
   */
  private getContainerName(id: ObjectId): string {
    return id.toString();
  }

  /**
   * Install a daemon
   */
  async install(manifest: DaemonManifest, auth: Auth): Promise<void> {
    const mongo = await getMongoResource(auth);

    // Check if daemon already exists
    const existing = await mongo({
      action: "findOne",
      collection: COLLECTION,
      query: { name: manifest.name },
    });

    if (existing) {
      throw new Error(`Daemon ${manifest.name} already exists`);
    }

    // Generate ObjectId for the daemon
    const daemonId = new ObjectId();
    const containerName = this.getContainerName(daemonId);

    try {
      // Check if image exists, pull if needed
      const imageExists = await dockerClient.imageExists(manifest.image);
      if (!imageExists) {
        await dockerClient.pullImage(manifest.image);
      }

      // Generate JWT token (use name for principal, not ID)
      // Get owner from principal (principal is typically the owner)
      const jwtToken = await signJWT(
        auth.principal,
        `daemon:${manifest.name}`,
        manifest.policies,
        "365 days", // Long-lived for daemons
      );

      // Merge environment variables
      const env = {
        ...this.getDefaultEnv(auth, jwtToken),
        ...manifest.env,
      };

      // Create container using ObjectId as name
      await dockerClient.createContainer(
        containerName,
        manifest.image,
        env,
        manifest.restart || "unless-stopped",
        this.convertHealthcheck(manifest.healthcheck),
        this.convertResources(manifest.resources),
      );

      // Save manifest to MongoDB with generated _id
      const doc = {
        ...manifest,
        _id: daemonId,
        targetState: "installed" as TargetState,
        installedAt: new Date(),
        installedBy: auth.principal,
      };

      await mongo({
        action: "insertOne",
        collection: COLLECTION,
        doc,
      });
    } catch (error) {
      const daemonError: DaemonError = {
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        code: "INSTALL_FAILED",
      };
      await this.storeError(auth, daemonId, daemonError);
      throw error;
    }
  }

  /**
   * Start a daemon
   */
  async start(name: string, auth: Auth): Promise<void> {
    const mongo = await getMongoResource(auth);

    // Load manifest
    const manifest = await mongo({
      action: "findOne",
      collection: COLLECTION,
      query: { name },
    }) as DaemonManifest | null;

    if (!manifest || !manifest._id) {
      throw new Error(`Daemon ${name} not found`);
    }

    const containerName = this.getContainerName(manifest._id);

    try {
      // Get or create container
      let container = await dockerClient.getContainer(containerName);
      if (!container) {
        // Container was removed, recreate it
        const jwtToken = await signJWT(
          auth.principal,
          `daemon:${manifest.name}`,
          manifest.policies,
          "365 days",
        );

        const env = {
          ...this.getDefaultEnv(auth, jwtToken),
          ...manifest.env,
        };

        container = await dockerClient.createContainer(
          containerName,
          manifest.image,
          env,
          manifest.restart || "unless-stopped",
          this.convertHealthcheck(manifest.healthcheck),
          this.convertResources(manifest.resources),
        );
      }

      // Start container
      await dockerClient.startContainer(container);

      // Update target state
      await mongo({
        action: "updateOne",
        collection: COLLECTION,
        query: { _id: manifest._id },
        update: {
          $set: { targetState: "running" as TargetState },
          $unset: { lastError: "" },
        },
      });
    } catch (error) {
      const daemonError: DaemonError = {
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        code: "START_FAILED",
      };
      await this.storeError(auth, manifest._id, daemonError);
      throw error;
    }
  }

  /**
   * Stop a daemon
   */
  async stop(name: string, auth: Auth): Promise<void> {
    const mongo = await getMongoResource(auth);

    // Load manifest
    const manifest = await mongo({
      action: "findOne",
      collection: COLLECTION,
      query: { name },
    }) as DaemonManifest | null;

    if (!manifest || !manifest._id) {
      throw new Error(`Daemon ${name} not found`);
    }

    const containerName = this.getContainerName(manifest._id);

    try {
      const container = await dockerClient.getContainer(containerName);
      if (container) {
        await dockerClient.stopContainer(container);
      }

      // Update target state
      await mongo({
        action: "updateOne",
        collection: COLLECTION,
        query: { _id: manifest._id },
        update: {
          $set: { targetState: "stopped" as TargetState },
          $unset: { lastError: "" },
        },
      });
    } catch (error) {
      const daemonError: DaemonError = {
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        code: "STOP_FAILED",
      };
      await this.storeError(auth, manifest._id, daemonError);
      throw error;
    }
  }

  /**
   * Remove a daemon
   */
  async remove(name: string, auth: Auth): Promise<void> {
    const mongo = await getMongoResource(auth);

    // Load manifest
    const manifest = await mongo({
      action: "findOne",
      collection: COLLECTION,
      query: { name },
    }) as DaemonManifest | null;

    if (!manifest || !manifest._id) {
      throw new Error(`Daemon ${name} not found`);
    }

    const containerName = this.getContainerName(manifest._id);

    try {
      // Stop and remove container
      const container = await dockerClient.getContainer(containerName);
      if (container) {
        const status = await dockerClient.getContainerStatus(containerName);
        if (status?.state === "running") {
          await dockerClient.stopContainer(container);
        }
        await dockerClient.removeContainer(container);
      }

      // Delete from MongoDB
      await mongo({
        action: "deleteOne",
        collection: COLLECTION,
        query: { _id: manifest._id },
      });
    } catch (error) {
      const daemonError: DaemonError = {
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
        code: "REMOVE_FAILED",
      };
      await this.storeError(auth, manifest._id, daemonError);
      throw error;
    }
  }

  /**
   * Get daemon status (target state from MongoDB, actual state from Docker)
   */
  async getStatus(name: string, auth: Auth): Promise<DaemonStatus> {
    const mongo = await getMongoResource(auth);

    // Load manifest (target state)
    const manifest = await mongo({
      action: "findOne",
      collection: COLLECTION,
      query: { name },
    }) as DaemonManifest | null;

    if (!manifest || !manifest._id) {
      throw new Error(`Daemon ${name} not found`);
    }

    const containerName = this.getContainerName(manifest._id);

    // Get actual state from Docker
    const actualState = await dockerClient.getContainerStatus(containerName);

    return {
      name,
      targetState: manifest.targetState,
      actualState,
      lastError: manifest.lastError,
    };
  }

  /**
   * List all daemons
   */
  async list(auth: Auth): Promise<DaemonManifest[]> {
    const mongo = await getMongoResource(auth);
    const daemons = await mongo({
      action: "find",
      collection: COLLECTION,
      query: {},
      options: { sort: { installedAt: -1 } },
    });

    return daemons as DaemonManifest[];
  }
}

export const daemonManager = new DaemonManager();

