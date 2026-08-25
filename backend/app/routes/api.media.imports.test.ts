import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.15";
import type { Request, Response } from "express";
import { Auth } from "@/lib/auth/core.server.ts";
import { authorizeAndReceiveMediaUpload } from "./api.media.imports.ts";

Deno.test("media upload authorization runs before multipart bytes are received", async () => {
  const calls: string[] = [];
  const auth = new Auth({ principal: "read-only-token" });

  await assertRejects(
    () =>
      authorizeAndReceiveMediaUpload(
        auth,
        {} as Request,
        {} as Response,
        async () => {
          calls.push("authorize");
          throw new Error("Permission denied");
        },
        async () => {
          calls.push("receive");
        },
      ),
    Error,
    "Permission denied",
  );

  assertEquals(calls, ["authorize"]);
});
