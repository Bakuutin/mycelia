import { Buffer } from "node:buffer";

export interface WyomingHeader {
  type: string;
  payload_length?: number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WyomingMessage {
  header: WyomingHeader;
  payload: Uint8Array | null;
}

function isBuffer(
  obj: any,
): obj is {
  isBuffer(): boolean;
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
} {
  if (obj && typeof obj.isBuffer === "function") {
    return obj.isBuffer();
  }
  if (
    obj && typeof Buffer !== "undefined" && Buffer.isBuffer &&
    Buffer.isBuffer(obj)
  ) {
    return true;
  }
  return false;
}

function isWebSocketOpen(ws: WebSocket | any): boolean {
  if (ws.readyState === WebSocket.OPEN) {
    return true;
  }
  if (ws.readyState === 1) {
    return true;
  }
  return false;
}

export async function parseWyomingProtocol(
  ws: WebSocket | any,
): Promise<WyomingMessage> {
  if (!isWebSocketOpen(ws)) {
    throw new Error("WebSocket is not open");
  }

  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);

      console.log("parseWyomingProtocol: Received message", event.data);

      const eventData = event.data;
      if (typeof eventData === "string" || isBuffer(eventData)) {
        const headerText = typeof eventData === "string"
          ? eventData
          : eventData.toString();
        const jsonLine = headerText.trim();

        try {
          const header: WyomingHeader = JSON.parse(jsonLine);

          const payloadLength = header.payload_length;
          if (payloadLength !== undefined && payloadLength > 0) {
            const payloadListener = (payloadEvent: MessageEvent | any) => {
              ws.removeEventListener("message", payloadListener);
              ws.removeEventListener("error", handleError);
              ws.removeEventListener("close", handleClose);

              const payloadData = payloadEvent.data || payloadEvent;
              if (payloadData instanceof ArrayBuffer) {
                const payload = new Uint8Array(payloadData);
                resolve({ header, payload });
              } else if (payloadData instanceof Uint8Array) {
                resolve({ header, payload: payloadData });
              } else if (isBuffer(payloadData)) {
                const payload = new Uint8Array(
                  payloadData.buffer,
                  payloadData.byteOffset,
                  payloadData.byteLength,
                );
                resolve({ header, payload });
              } else {
                reject(
                  new Error(
                    `Expected binary payload but got: ${typeof payloadData}`,
                  ),
                );
              }
            };

            ws.addEventListener("message", payloadListener);
            ws.addEventListener("error", handleError);
            ws.addEventListener("close", handleClose);
          } else {
            resolve({ header, payload: null });
          }
        } catch (error) {
          reject(
            new Error(
              `Failed to parse Wyoming protocol header: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            ),
          );
        }
      } else {
        reject(
          new Error(
            "Raw binary messages not supported - Wyoming protocol requires JSONL headers",
          ),
        );
      }
    };

    const handleError = (event: Event) => {
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);
      reject(new Error("WebSocket error occurred"));
    };

    const handleClose = (event: CloseEvent) => {
      ws.removeEventListener("message", handleMessage);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);
      reject(
        new Error(
          `WebSocket closed. Code: ${event.code}, Reason: ${
            event.reason || "No reason provided"
          }`,
        ),
      );
    };

    ws.addEventListener("message", handleMessage);
    ws.addEventListener("error", handleError);
    ws.addEventListener("close", handleClose);
  });
}
