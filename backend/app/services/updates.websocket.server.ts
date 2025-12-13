import type { IncomingMessage } from "node:http";
import type { WebSocket } from "npm:ws@^8.18.0";
import { redis } from "@/lib/redis.ts";
import { authenticate } from "@/lib/auth/core.server.ts";
import type { Redis } from "ioredis";
import { getQueue } from "@/lib/jobs/queue.ts";
import { JobTypeSchema } from "@/lib/jobs/types.ts";

async function createRequestFromUpgrade(
  upgrade: IncomingMessage,
): Promise<Request> {
  const url = upgrade.url || "/";
  const headers = new Headers();

  for (const [key, value] of Object.entries(upgrade.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      } else {
        headers.set(key, value);
      }
    }
  }

  const protocol = "http";
  const host = upgrade.headers.host || "localhost";

  return new Request(`${protocol}://${host}${url}`, {
    method: "GET",
    headers,
  });
}

interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  channel?: string;
}

interface ServerMessage {
  type: "subscribed" | "unsubscribed" | "event" | "pong" | "error";
  channel?: string;
  event?: string;
  data?: any;
  message?: string;
}

class UpdatesWebSocketSession {
  private ws: WebSocket;
  private subscriptions: Set<string> = new Set();
  private redisSubscriber: Redis;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.redisSubscriber = redis.duplicate();
  }

  async initialize(): Promise<void> {
    if (redis.status !== "ready" && redis.status !== "connect") {
      await redis.connect();
    }

    if (this.redisSubscriber.status !== "ready") {
      await this.redisSubscriber.connect();
    }

    this.redisSubscriber.on("message", (channel: string, message: string) => {
      try {
        const payload = JSON.parse(message);
        const cleanChannel = channel.replace(/^mycelia:/, "");

        this.sendMessage({
          type: "event",
          channel: cleanChannel,
          event: payload.event,
          data: payload.data,
        });
      } catch (error) {
        console.error("Error handling Redis message:", error);
      }
    });
  }

  async handleMessage(rawMessage: string): Promise<void> {
    try {
      console.log(`WebSocket received message: ${rawMessage}`);
      const message: ClientMessage = JSON.parse(rawMessage);

      switch (message.type) {
        case "subscribe":
          if (message.channel) {
            await this.subscribe(message.channel);
          }
          break;

        case "unsubscribe":
          if (message.channel) {
            await this.unsubscribe(message.channel);
          }
          break;

        case "ping":
          this.sendMessage({ type: "pong" });
          break;

        default:
          this.sendMessage({
            type: "error",
            message: `Unknown message type: ${(message as any).type}`,
          });
      }
    } catch (error) {
      console.error(`WebSocket message handling error:`, error);
      this.sendMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Invalid message format",
      });
    }
  }

  async subscribe(channel: string): Promise<void> {
    if (this.subscriptions.has(channel)) {
      this.sendMessage({ type: "subscribed", channel });
      return;
    }

    const redisChannel = `mycelia:${channel}`;
    await this.redisSubscriber.subscribe(redisChannel);

    this.subscriptions.add(channel);
    this.sendMessage({ type: "subscribed", channel });

    console.log(`WebSocket subscribed to channel: ${channel}`);

    // Send current state for job subscriptions
    if (channel.startsWith("jobs:") && channel !== "jobs:*") {
      const jobId = channel.replace("jobs:", "");
      await this.sendCurrentJobState(jobId);
    }
  }

  async sendCurrentJobState(jobId: string): Promise<void> {
    try {
      // Try each job type to find the job
      for (const jobType of JobTypeSchema.options) {
        const queue = getQueue(jobType);
        const job = await queue.getJob(jobId);

        if (job) {
          const state = await job.getState();

          console.log(`Sending current state for job ${jobId}: ${state}`);

          this.sendMessage({
            type: "event",
            channel: `jobs:${jobId}`,
            event: `job.${state}`,
            data: {
              jobId: job.id,
              jobType: jobType,
              state: state,
              progress: job.progress,
              result: job.returnvalue,
              failedReason: job.failedReason,
            },
          });
          return;
        }
      }

      console.log(`Job ${jobId} not found in any queue`);
    } catch (error) {
      console.error(`Error fetching current state for job ${jobId}:`, error);
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.subscriptions.has(channel)) {
      return;
    }

    const redisChannel = `mycelia:${channel}`;
    await this.redisSubscriber.unsubscribe(redisChannel);

    this.subscriptions.delete(channel);
    this.sendMessage({ type: "unsubscribed", channel });

    console.log(`WebSocket unsubscribed from channel: ${channel}`);
  }

  sendMessage(message: ServerMessage): void {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async cleanup(): Promise<void> {
    try {
      if (this.subscriptions.size > 0) {
        const channels = Array.from(this.subscriptions).map(ch => `mycelia:${ch}`);
        await this.redisSubscriber.unsubscribe(...channels);
      }

      this.subscriptions.clear();

      if (this.redisSubscriber) {
        this.redisSubscriber.disconnect();
      }
    } catch (error) {
      console.error("Error during cleanup:", error);
    }
  }
}

export async function handleUpdatesWebSocket(
  ws: WebSocket,
  request: IncomingMessage,
): Promise<void> {
  let session: UpdatesWebSocketSession | null = null;

  try {
    console.log("WebSocket /ws connection attempt");

    const req = await createRequestFromUpgrade(request);
    const auth = await authenticate(req);

    if (!auth) {
      console.log("WebSocket /ws: Authentication failed");
      ws.close(1008, "Unauthorized");
      return;
    }

    console.log("WebSocket /ws: Authenticated successfully");

    session = new UpdatesWebSocketSession(ws);

    // Attach message handler BEFORE initializing session
    // This prevents race condition where client sends messages before handler is ready
    ws.on("message", async (data: any) => {
      try {
        const message = data.toString();
        await session!.handleMessage(message);
      } catch (msgError) {
        console.error("WebSocket /ws: Error handling message:", msgError);
      }
    });

    ws.on("close", async () => {
      if (session) {
        await session.cleanup();
      }
      console.log("WebSocket /ws: Connection closed");
    });

    ws.on("error", async (error: Error) => {
      console.error("WebSocket /ws: Socket error:", error);
      if (session) {
        await session.cleanup();
      }
    });

    try {
      await session.initialize();
      console.log("WebSocket /ws: Session initialized");
    } catch (initError) {
      console.error("WebSocket /ws: Failed to initialize session:", initError);
      throw initError;
    }

    console.log("WebSocket /ws: Connection established successfully");
  } catch (error) {
    console.error("WebSocket /ws: Handler error:", error);
    if (ws.readyState === 1) {
      ws.close(1011, "Internal server error");
    }
    if (session) {
      try {
        await session.cleanup();
      } catch (cleanupError) {
        console.error("WebSocket /ws: Cleanup error:", cleanupError);
      }
    }
  }
}
