import { expect } from "@std/expect";
import type { IncomingMessage } from "node:http";
import { getAuthorizationHeader } from "@/lib/auth/core.server.ts";
import { createRequestFromUpgrade } from "./updates.websocket.server.ts";

function upgradeRequest(
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    url,
    headers: { host: "localhost:5173", ...headers },
  } as IncomingMessage;
}

Deno.test("updates websocket accepts JWT from the token query parameter", async () => {
  const request = await createRequestFromUpgrade(
    upgradeRequest("/ws?token=signed-jwt"),
  );

  expect(request.headers.get("Authorization")).toBe("Bearer signed-jwt");
  expect(getAuthorizationHeader(request)).toBe("Bearer signed-jwt");
});

Deno.test("updates websocket preserves an Authorization header", async () => {
  const request = await createRequestFromUpgrade(
    upgradeRequest("/ws?token=query-jwt", {
      authorization: "Bearer header-jwt",
    }),
  );

  expect(request.headers.get("Authorization")).toBe("Bearer header-jwt");
});
