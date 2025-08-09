import type { ActionFunctionArgs } from "@remix-run/node";
import {
  extractClientCredentials,
  oauthErrorJson,
  tokenRequestSchema,
} from "@/lib/auth/oauth.ts";
import { decodeAccessToken, verifyApiKey } from "@/lib/auth/tokens.ts";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const creds = await extractClientCredentials(request);

  const parsed = tokenRequestSchema.safeParse({
    grant_type: creds.grantType ?? undefined,
    client_secret: creds.clientSecret || undefined,
    client_id: creds.clientId || undefined,
  });

  if (!parsed.success) {
    return oauthErrorJson("invalid_request", 400);
  }

  const keyDoc = await verifyApiKey(creds.clientSecret);
  if (!keyDoc) {
    return oauthErrorJson("invalid_client", 401);
  }

  if (keyDoc._id?.toString() !== creds.clientId) {
    return oauthErrorJson("invalid_client", 401);
  }

  const jwt = await decodeAccessToken(creds.clientSecret, "1 day");
  if (!jwt) {
    return oauthErrorJson("invalid_client", 401);
  }

  const body = {
    access_token: jwt,
    token_type: "bearer",
    expires_in: 86400,
    scope: "*",
  };
  return Response.json(body, { status: 200 });
}
