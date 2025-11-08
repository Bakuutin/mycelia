import Docker from "npm:dockerode@4.0.9";
import type { ContainerStatus } from "./core.ts";

export class DockerClient {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Get container by name (daemon name)
   */
  async getContainer(name: string): Promise<Docker.Container | null> {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const containerInfo = containers.find((c: Docker.ContainerInfo) =>
        c.Names.some((n: string) => n === `/${name}` || n === name)
      );

      if (!containerInfo) {
        return null;
      }

      return this.docker.getContainer(containerInfo.Id);
    } catch (error) {
      console.error(`Error getting container ${name}:`, error);
      return null;
    }
  }

  /**
   * Create a container from configuration
   */
  async createContainer(
    name: string,
    image: string,
    env: Record<string, string>,
    restartPolicy: "always" | "unless-stopped" | "no",
    healthcheck: Docker.HealthConfig | undefined,
    resources: Docker.Resources | undefined,
  ): Promise<Docker.Container> {
    const envArray = Object.entries(env).map(([key, value]) => `${key}=${value}`);

    const containerConfig: Docker.ContainerCreateOptions = {
      Image: image,
      name,
      Env: envArray,
      RestartPolicy: {
        Name: restartPolicy === "no" ? "no" : restartPolicy,
      },
      Healthcheck: healthcheck,
      HostConfig: {
        Resources: resources,
      },
    };

    const container = await this.docker.createContainer(containerConfig);
    return container;
  }

  /**
   * Start a container
   */
  async startContainer(container: Docker.Container): Promise<void> {
    await container.start();
  }

  /**
   * Stop a container
   */
  async stopContainer(container: Docker.Container): Promise<void> {
    await container.stop();
  }

  /**
   * Remove a container
   */
  async removeContainer(container: Docker.Container): Promise<void> {
    await container.remove({ force: true });
  }

  /**
   * Get container status
   */
  async getContainerStatus(name: string): Promise<ContainerStatus | null> {
    const container = await this.getContainer(name);
    if (!container) {
      return null;
    }

    try {
      const inspect = await container.inspect();
      return {
        id: inspect.Id,
        state: inspect.State.Status as ContainerStatus["state"],
        startedAt: inspect.State.StartedAt || null,
        finishedAt: inspect.State.FinishedAt || null,
      };
    } catch (error) {
      console.error(`Error inspecting container ${name}:`, error);
      return null;
    }
  }

  /**
   * Pull an image
   */
  async pullImage(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        this.docker.modem.followProgress(stream, (err: Error | null, output: unknown) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    });
  }

  /**
   * Check if image exists locally
   */
  async imageExists(image: string): Promise<boolean> {
    try {
      const img = this.docker.getImage(image);
      await img.inspect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(
    container: Docker.Container,
    options: {
      tail?: number;
      since?: string;
      until?: string;
      follow?: boolean;
    } = {},
  ): Promise<NodeJS.ReadableStream> {
    const logOptions: Docker.ContainerLogsOptions = {
      stdout: true,
      stderr: true,
      tail: options.tail || 100,
      since: options.since ? Math.floor(new Date(options.since).getTime() / 1000) : undefined,
      until: options.until ? Math.floor(new Date(options.until).getTime() / 1000) : undefined,
      follow: options.follow || false,
    };

    return container.logs(logOptions) as Promise<NodeJS.ReadableStream>;
  }
}

export const dockerClient = new DockerClient();

