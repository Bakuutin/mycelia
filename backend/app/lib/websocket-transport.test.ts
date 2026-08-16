import { EventEmitter } from "node:events";
import { assert, assertEquals } from "jsr:@std/assert@^1.0.14";
import {
  isExpectedWebSocketDisconnect,
  sendWebSocket,
  type WebSocketPeer,
  WebSocketSupervisor,
} from "./websocket-transport.ts";

class FakeWebSocket extends EventEmitter implements WebSocketPeer {
  readyState = 1;
  bufferedAmount = 0;
  terminateCalls = 0;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  pingCalls = 0;
  sendError: Error | undefined;

  send(
    _data: string | Uint8Array,
    callback?: (error?: Error) => void,
  ): void {
    callback?.(this.sendError);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  terminate(): void {
    this.terminateCalls++;
    this.readyState = 3;
  }

  ping(
    _data?: string | Uint8Array,
    _mask?: boolean,
    callback?: (error?: Error) => void,
  ): void {
    this.pingCalls++;
    callback?.();
  }
}

Deno.test("expected WebSocket disconnect classification stays narrow", () => {
  assert(isExpectedWebSocketDisconnect(new Deno.errors.BrokenPipe("closed")));
  assert(isExpectedWebSocketDisconnect(Object.assign(new Error("write"), {
    code: "EPIPE",
  })));
  assertEquals(
    isExpectedWebSocketDisconnect(new Error("database failed")),
    false,
  );
});

Deno.test("async ws send failure terminates the failed peer once", () => {
  const socket = new FakeWebSocket();
  socket.sendError = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

  assertEquals(sendWebSocket(socket, "payload", "test"), true);
  assertEquals(socket.terminateCalls, 1);
});

Deno.test("slow WebSocket consumers cannot grow an unbounded send queue", () => {
  const socket = new FakeWebSocket();
  socket.bufferedAmount = 9 * 1024 * 1024;

  assertEquals(sendWebSocket(socket, "payload", "test"), false);
  assertEquals(socket.terminateCalls, 1);
});

Deno.test("heartbeat keeps pong peers and terminates a missed heartbeat", () => {
  const socket = new FakeWebSocket();
  const supervisor = new WebSocketSupervisor(60_000);
  supervisor.track(socket, "test");

  supervisor.checkConnections();
  assertEquals(socket.pingCalls, 1);
  assertEquals(socket.terminateCalls, 0);

  socket.emit("pong");
  supervisor.checkConnections();
  assertEquals(socket.pingCalls, 2);
  assertEquals(socket.terminateCalls, 0);

  supervisor.checkConnections();
  assertEquals(socket.terminateCalls, 1);
  supervisor.stop();
});

Deno.test("backend image cannot regress to the broken Deno writev runtime", async () => {
  const dockerfile = await Deno.readTextFile(
    new URL("../../Dockerfile", import.meta.url),
  );
  const match = dockerfile.match(
    /FROM\s+denoland\/deno:(\d+)\.(\d+)\.(\d+)@sha256:[a-f0-9]{64}/,
  );
  assert(match, "backend/Dockerfile must pin an exact Deno version and digest");

  const version = match.slice(1).map(Number);
  const minimumFixed = [2, 7, 13];
  const isAtLeastFixed =
    version.some((part, index) =>
      part > minimumFixed[index] &&
      version.slice(0, index).every((value, i) => value === minimumFixed[i])
    ) || version.every((part, index) => part === minimumFixed[index]);

  assert(
    isAtLeastFixed,
    `Deno ${
      version.join(".")
    } contains the unhandled node:net writev rejection`,
  );
});
