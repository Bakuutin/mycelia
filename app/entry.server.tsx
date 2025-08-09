import type { AppLoadContext, EntryContext } from "@remix-run/deno";
import { RemixServer } from "@remix-run/react";
import * as isbotModule from "isbot";
import { renderToReadableStream } from "react-dom/server";
import React from "react";
import { defaultResourceManager } from "./lib/auth/resources.ts";
import { KafkaResource } from "./lib/kafka/index.ts";
import { MongoResource } from "./lib/mongo/core.server.ts";
import { FsResource } from "./lib/mongo/fs.server.ts";

defaultResourceManager.registerResource(KafkaResource);
defaultResourceManager.registerResource(MongoResource);
defaultResourceManager.registerResource(FsResource);

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  loadContext: AppLoadContext,
) {
  const body = await renderToReadableStream(
    <RemixServer context={remixContext} url={request.url} />,
    {
      onError(error: unknown) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );

  if (isBotRequest(request.headers.get("user-agent"))) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

function isBotRequest(userAgent: string | null) {
  return userAgent && isbotModule.isbot(userAgent);
}
