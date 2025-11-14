import { type Auth, authenticateOr401 } from "@/lib/auth/core.server.ts";
import { type WyomingHeader } from "@/lib/audio/wyoming.ts";
import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import {
  createAudioChunk,
  createSourceFile,
} from "@/services/streaming.server.ts";
import { ObjectId } from "mongodb";
import Denque from "denque";
import { defaultResourceManager } from "@/lib/auth/index.ts";

const CHUNK_DURATION_SECONDS = 10;

interface AudioFormat {
  rate: number;
  width: number;
  channels: number;
  mode: string;
  timestamp?: number;
}

class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.locked = true;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.locked = false;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      };

      if (this.locked) {
        this.queue.push(execute);
      } else {
        execute();
      }
    });
  }
}

class PcmWebSocketSession {
  sourceFileId: ObjectId | null = null;
  audioFormat: AudioFormat | null = null;
  startedAt: Date | null = null;
  buffer: Denque<number> = new Denque();
  bytesFlushed = 0;
  chunkIndex = 0;
  bytesPerChunk = 0;
  private flushLock = new AsyncLock();

  constructor(
    private auth: Auth,
    private ws: WebSocket | any,
  ) {}

  async handleAudioStart(header: WyomingHeader): Promise<void> {
    if (!header.data) {
      return;
    }

    const audioFormat = header.data as unknown as AudioFormat;
    const startTime = audioFormat.timestamp
      ? new Date(audioFormat.timestamp * 1000)
      : new Date();

    this.audioFormat = audioFormat;
    this.startedAt = startTime;
    this.bytesFlushed = 0;
    this.chunkIndex = 0;
    this.buffer.clear();

    const bytesPerSecond = audioFormat.rate * audioFormat.width *
      audioFormat.channels;
    this.bytesPerChunk = bytesPerSecond * CHUNK_DURATION_SECONDS;

    const metadata = {
      rate: audioFormat.rate,
      width: audioFormat.width,
      channels: audioFormat.channels,
      mode: audioFormat.mode,
      format: "float32",
      source: "websocket",
    };

    const filename = `audio_${
      audioFormat.timestamp || Date.now()
    }_${Date.now()}.pcm`;

    try {
      this.sourceFileId = await createSourceFile(
        startTime,
        undefined,
        filename,
        metadata,
        this.auth.principal,
      );
      const formatDescription = `${audioFormat.rate}Hz ${
        audioFormat.width * 8
      }bit ${audioFormat.channels}ch`;
      console.log(
        `Created SourceFile: ${this.sourceFileId.toString()}, start: ${startTime.toISOString()}, format: ${formatDescription}`,
      );
    } catch (error) {
      console.error("Failed to create SourceFile:", error);
      const errorMessage = error instanceof Error
        ? error.message
        : "Failed to create source file";
      this.ws.send(
        JSON.stringify({ type: "error", message: errorMessage }) + "\n",
      );
    }
  }

  async handleAudioStop(): Promise<void> {
    console.log("Audio stop received");
    if (this.sourceFileId) {
      await this.flushAll();
      console.log(
        `Session ended with SourceFile: ${this.sourceFileId.toString()}`,
      );
    }
  }

  async addAudioData(audioData: Uint8Array): Promise<void> {
    if (!this.sourceFileId) {
      return;
    }

    if (
      this.audioFormat && audioData.byteLength % this.audioFormat.width !== 0
    ) {
      console.warn(
        `Audio data length ${audioData.byteLength} is not divisible by ${this.audioFormat.width} (${
          this.audioFormat.width * 8
        }-bit float requires ${this.audioFormat.width} bytes per sample)`,
      );
    }

    for (let i = 0; i < audioData.length; i++) {
      this.buffer.push(audioData[i]);
    }
    await this.checkAndFlushIfNeeded();
  }

  private calculateTimeFromBytes(bytes: number): number {
    if (!this.audioFormat) {
      return 0;
    }
    const bytesPerSecond = this.audioFormat.rate * this.audioFormat.width *
      this.audioFormat.channels;
    return bytes / bytesPerSecond;
  }

  private calculateChunkStartTime(): Date {
    if (!this.startedAt || !this.audioFormat) {
      return new Date();
    }
    const secondsOffset = this.calculateTimeFromBytes(this.bytesFlushed);
    return new Date(this.startedAt.getTime() + secondsOffset * 1000);
  }

  private getBufferSize(): number {
    return this.buffer.length;
  }

  private async checkAndFlushIfNeeded(): Promise<void> {
    if (!this.sourceFileId || !this.audioFormat) {
      return;
    }

    if (this.bytesPerChunk === 0) {
      return;
    }

    await this.flushLock.acquire(async () => {
      const currentBufferSize = this.getBufferSize();
      if (currentBufferSize < this.bytesPerChunk) {
        return;
      }

      const numberOfChunks = Math.floor(currentBufferSize / this.bytesPerChunk);

      for (let i = 0; i < numberOfChunks; i++) {
        const remainingBufferSize = this.getBufferSize();
        if (remainingBufferSize < this.bytesPerChunk) {
          break;
        }
        await this.performFlush();
      }
    });
  }

  private async flush(flushAll: boolean = false): Promise<void> {
    if (
      !this.sourceFileId || !this.startedAt || !this.audioFormat ||
      !this.buffer.length
    ) {
      return;
    }

    while (this.buffer.length > 0) {
      const hasWholeChunk = this.buffer.length >= this.bytesPerChunk;

      if (!flushAll && !hasWholeChunk) {
        break;
      }

      const bytesToFlush = flushAll ? this.buffer.length : this.bytesPerChunk;

      if (bytesToFlush === 0) {
        break;
      }

      const audioData = new Uint8Array(bytesToFlush);

      for (let i = 0; i < bytesToFlush; i++) {
        const byte = this.buffer.shift();
        if (byte === undefined) {
          break;
        }
        audioData[i] = byte;
      }

      const chunkStartTime = this.calculateChunkStartTime();

      try {
        await createAudioChunk(
          audioData,
          chunkStartTime,
          this.chunkIndex,
          this.sourceFileId,
          "float32",
        );
        const logMessage = flushAll
          ? `Flushed final audio chunk ${this.chunkIndex}, size: ${audioData.length} bytes, start: ${chunkStartTime.toISOString()}`
          : `Flushed audio chunk ${this.chunkIndex}, size: ${audioData.length} bytes, start: ${chunkStartTime.toISOString()}`;
        console.log(logMessage);
        this.bytesFlushed += audioData.length;
        this.chunkIndex++;
      } catch (error) {
        const errorMessage = flushAll
          ? "Failed to flush final audio chunk:"
          : "Failed to flush audio chunk:";
        console.error(errorMessage, error);
        throw error;
      }
    }
  }

  private async performFlush(): Promise<void> {
    await this.flush(false);
  }

  async flushAll(): Promise<void> {
    await this.flush(true);
  }
}

class WyomingPayloadHandler {
  private expectingLength = 0;
  private buffer: Uint8Array[] = [];
  private expectedMessageType: string | null = null;

  get isExpectingPayload(): boolean {
    return this.expectingLength > 0;
  }

  get pendingMessageType(): string | null {
    return this.expectedMessageType;
  }

  setExpectedLength(length: number, messageType?: string): void {
    this.expectingLength = length;
    this.buffer = [];
    this.expectedMessageType = messageType || null;
  }

  addChunk(
    data: Uint8Array,
  ): { payload: Uint8Array; messageType: string | null } | null {
    if (this.expectingLength === 0) {
      return null;
    }

    this.buffer.push(data);
    const totalLength = this.buffer.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    );

    if (totalLength < this.expectingLength) {
      return null;
    }

    const combined = new Uint8Array(this.expectingLength);
    let offset = 0;
    for (const chunk of this.buffer) {
      const copyLength = Math.min(chunk.length, this.expectingLength - offset);
      combined.set(chunk.slice(0, copyLength), offset);
      offset += copyLength;
      if (offset >= this.expectingLength) break;
    }

    const messageType = this.expectedMessageType;
    this.buffer = [];
    this.expectingLength = 0;
    this.expectedMessageType = null;

    return { payload: combined, messageType };
  }
}

function normalizeBinaryData(data: any): Uint8Array {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(Buffer.from(data));
}

function parseWyomingHeader(line: string): WyomingHeader | null {
  try {
    return JSON.parse(line) as WyomingHeader;
  } catch (error) {
    console.error("Failed to parse Wyoming protocol header:", error);
    return null;
  }
}

function handlePing(ws: WebSocket | any): void {
  ws.send(JSON.stringify({ type: "pong" }) + "\n");
}

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

  const urlObj = new URL(url, `http://${upgrade.headers.host || "localhost"}`);
  const tokenParam = urlObj.searchParams.get("token");

  if (tokenParam && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${tokenParam}`);
  }

  return new Request(urlObj.toString(), {
    method: "GET",
    headers,
  });
}

export async function handlePcmWebSocket(
  ws: WebSocket | any,
  upgrade: IncomingMessage,
): Promise<void> {
  const request = await createRequestFromUpgrade(upgrade);
  const auth = await authenticateOr401(request);
  await defaultResourceManager.ensureAllowed(
    auth,
    { path: "live.audio", actions: ["write"] },
  );
  return new Promise((resolve, reject) => {
    const session = new PcmWebSocketSession(auth, ws);
    const payloadHandler = new WyomingPayloadHandler();
    let textBuffer = "";

    const handleBinaryMessage = async (data: any): Promise<void> => {
      const binaryData = normalizeBinaryData(data);

      if (binaryData.length > 0 && binaryData[0] === 0x7B) {
        const newlineIndex = binaryData.indexOf(0x0A);
        if (newlineIndex !== -1) {
          const headerBytes = binaryData.slice(0, newlineIndex + 1);
          const headerText = new TextDecoder().decode(headerBytes);
          const header = parseWyomingHeader(headerText.trim());

          if (header && header.payload_length !== undefined) {
            const payloadStart = newlineIndex + 1;
            const payloadData = binaryData.slice(payloadStart);

            if (payloadData.length === header.payload_length) {
              if (header.type === "audio-chunk") {
                await session.addAudioData(payloadData);
              }
              return;
            }

            payloadHandler.setExpectedLength(
              header.payload_length,
              header.type,
            );
            const payloadResult = payloadHandler.addChunk(payloadData);
            if (payloadResult) {
              const { payload, messageType } = payloadResult;
              console.log(
                `Received Wyoming protocol payload, length: ${payload.length}, type: ${messageType}`,
              );

              if (messageType === "audio-chunk") {
                await session.addAudioData(payload);
              }
            }
            return;
          }
        }
      }

      const payloadResult = payloadHandler.addChunk(binaryData);
      if (payloadResult) {
        const { payload, messageType } = payloadResult;
        console.log(
          `Received Wyoming protocol payload, length: ${payload.length}, type: ${messageType}`,
        );

        if (messageType === "audio-chunk") {
          await session.addAudioData(payload);
        }
      } else if (!payloadHandler.isExpectingPayload) {
        await session.addAudioData(binaryData);
      }
    };

    const handleTextMessage = async (data: any): Promise<void> => {
      const text = typeof data === "string" ? data : data.toString();
      textBuffer += text;

      while (textBuffer.includes("\n")) {
        const lineEnd = textBuffer.indexOf("\n");
        const line = textBuffer.slice(0, lineEnd);
        textBuffer = textBuffer.slice(lineEnd + 1);

        if (!line.trim()) {
          continue;
        }

        const header = parseWyomingHeader(line);
        if (!header) {
          continue;
        }

        console.log("Received Wyoming protocol header:", header);

        if (header.type === "audio-start") {
          await session.handleAudioStart(header);
        } else if (header.type === "audio-stop") {
          await session.handleAudioStop();
        } else if (header.type === "ping") {
          handlePing(ws);
        }

        if (header.payload_length && header.payload_length > 0) {
          payloadHandler.setExpectedLength(header.payload_length, header.type);
        }
      }
    };

    const handleMessage = async (
      data: any,
      isBinary: boolean,
    ): Promise<void> => {
      try {
        if (isBinary) {
          await handleBinaryMessage(data);
        } else {
          await handleTextMessage(data);
        }
      } catch (error) {
        console.error("Error handling message:", error);
      }
    };

    const handleError = (error: Error) => {
      console.error("WebSocket error:", error);
      cleanup();
      reject(error);
    };

    const handleClose = (code: number, reason: Buffer) => {
      const reasonStr = reason ? reason.toString() : "";
      console.log("WebSocket closed", code, reasonStr);
      cleanup();
      resolve();
    };

    const cleanup = () => {
      session.flushAll().catch((error) => {
        console.error("Error flushing buffer on cleanup:", error);
      });

      if (typeof ws.off === "function") {
        ws.off("message", handleMessage);
        ws.off("error", handleError);
        ws.off("close", handleClose);
      } else if (typeof ws.removeEventListener === "function") {
        ws.removeEventListener("message", handleMessage);
        ws.removeEventListener("error", handleError);
        ws.removeEventListener("close", handleClose);
      }
    };

    if (typeof ws.on === "function") {
      ws.on("message", (data: any, isBinary: boolean) => {
        handleMessage(data, isBinary).catch((error) => {
          console.error("Error handling message:", error);
        });
      });
      ws.on("error", handleError);
      ws.on("close", handleClose);
    } else if (typeof ws.addEventListener === "function") {
      ws.addEventListener("message", async (event: MessageEvent) => {
        let data: any = event.data;
        let isBinary = false;

        if (event.data instanceof Blob) {
          data = await event.data.arrayBuffer();
          isBinary = true;
        } else if (event.data instanceof ArrayBuffer) {
          isBinary = true;
        }

        handleMessage(data, isBinary).catch((error) => {
          console.error("Error handling message:", error);
        });
      });
      ws.addEventListener("error", handleError);
      ws.addEventListener(
        "close",
        (event: CloseEvent) =>
          handleClose(event.code, Buffer.from(event.reason || "")),
      );
    } else {
      reject(
        new Error(
          "WebSocket object does not support 'on' or 'addEventListener' methods",
        ),
      );
    }
  });
}
