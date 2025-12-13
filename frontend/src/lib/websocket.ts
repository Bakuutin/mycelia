import { apiClient } from "@/lib/api";

interface ServerMessage {
  type: "subscribed" | "unsubscribed" | "event" | "pong" | "error";
  channel?: string;
  event?: string;
  data?: any;
  message?: string;
}

type EventCallback = (event: any) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Set<EventCallback>> = new Map();
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private isIntentionalClose = false;
  private connectionPromise: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.isConnecting && this.connectionPromise) {
      return this.connectionPromise;
    }

    this.isConnecting = true;
    this.connectionPromise = this._connect();

    try {
      await this.connectionPromise;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  private async _connect(): Promise<void> {
    const jwt = await apiClient.getJWT();
    const wsUrl = new URL(apiClient.baseURL + "/ws");
    wsUrl.protocol = wsUrl.protocol.replace("http", "ws");

    if (jwt) {
      wsUrl.searchParams.set("token", jwt);
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl.toString());

        this.ws.onopen = () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;

          for (const channel of this.subscriptions.keys()) {
            this.sendMessage({ type: "subscribe", channel });
          }

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: ServerMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

        this.ws.onclose = () => {
          console.log("WebSocket closed");
          this.ws = null;

          if (!this.isIntentionalClose) {
            this.scheduleReconnect();
          }
        };

        setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            reject(new Error("WebSocket connection timeout"));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.isIntentionalClose = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscriptions.clear();
  }

  subscribe(channel: string, callback: EventCallback): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: "subscribe", channel });
      }
    }

    this.subscriptions.get(channel)!.add(callback);

    if (
      this.ws?.readyState !== WebSocket.OPEN &&
      !this.isIntentionalClose &&
      !this.isConnecting
    ) {
      this.connect().catch((error) => {
        console.error("Failed to connect WebSocket:", error);
      });
    }

    return () => {
      this.unsubscribe(channel, callback);
    };
  }

  unsubscribe(channel: string, callback: EventCallback): void {
    const callbacks = this.subscriptions.get(channel);
    if (!callbacks) return;

    callbacks.delete(callback);

    if (callbacks.size === 0) {
      this.subscriptions.delete(channel);

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: "unsubscribe", channel });
      }
    }
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "event":
        if (message.channel) {
          const callbacks = this.subscriptions.get(message.channel);
          if (callbacks) {
            for (const callback of callbacks) {
              try {
                callback({
                  channel: message.channel,
                  event: message.event,
                  data: message.data,
                });
              } catch (error) {
                console.error("Error in WebSocket event callback:", error);
              }
            }
          }
        }
        break;

      case "subscribed":
        console.log(`Subscribed to channel: ${message.channel}`);
        break;

      case "unsubscribed":
        console.log(`Unsubscribed from channel: ${message.channel}`);
        break;

      case "error":
        console.error(`WebSocket error: ${message.message}`);
        break;

      case "pong":
        break;
    }
  }

  private sendMessage(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(message);
      console.log(`WebSocket sending: ${messageStr}`);
      this.ws.send(messageStr);
    } else {
      console.warn(`WebSocket not open, cannot send:`, message, `readyState: ${this.ws?.readyState}`);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnect attempts reached");
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        console.error("Reconnect failed:", error);
      });
    }, delay) as unknown as number;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new WebSocketClient();
