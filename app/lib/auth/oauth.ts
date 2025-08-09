import { z } from "zod";

export const tokenRequestSchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_secret: z.string(),
  client_id: z.string(),
});

export type TokenRequestInput = z.input<typeof tokenRequestSchema>;
export type TokenRequest = z.infer<typeof tokenRequestSchema>;

export type ClientCredentials = {
  clientId: string;
  clientSecret: string;
  grantType: string | null;
  scope: string | null;
};

function parseBasicAuthHeader(
  header: string | null,
): { clientId: string; clientSecret: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6));
    const [id, secret] = decoded.split(":");
    if (!id || !secret) return null;
    return { clientId: id, clientSecret: secret };
  } catch {
    return null;
  }
}

async function parseRequestParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await request.text());
  }
  if (contentType.includes("application/json")) {
    const body = await request.json();
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body ?? {})) {
      params.set(k, String(v));
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

export async function extractClientCredentials(
  request: Request,
): Promise<ClientCredentials> {
  const authHeader = request.headers.get("authorization");
  const basic = parseBasicAuthHeader(authHeader);
  const params = await parseRequestParams(request);
  const grantType = params.get("grant_type");
  const scope = params.get("scope");
  const clientIdFromHeader = basic?.clientId || "";
  const clientSecretFromHeader = basic?.clientSecret || "";
  const clientIdFromBody = params.get("client_id") || "";
  const clientSecretFromBody = params.get("client_secret") || "";
  const clientId = clientIdFromBody || clientIdFromHeader;
  const clientSecret = clientSecretFromBody || clientSecretFromHeader;
  return { clientId, clientSecret, grantType, scope };
}

export type ErrorDetail = string | ErrorDetail[] | { [key: string]: ErrorDetail };

export function oauthErrorJson(
  detail: ErrorDetail,
  status = 400,
): Response {
  return Response.json({ error: detail }, { status });
}

export const authorizationServerMetadataSchema = z.object({
  issuer: z.string().url(),
  token_endpoint: z.string().url(),
  registration_endpoint: z.string().url().optional(),
  grant_types_supported: z.array(z.literal("client_credentials")),
  token_endpoint_auth_methods_supported: z.array(
    z.union([
      z.literal("client_secret_basic"),
      z.literal("client_secret_post"),
    ]),
  ),
  response_types_supported: z.array(z.string()),
  scopes_supported: z.array(z.string()),
});

export type AuthorizationServerMetadata = z.infer<
  typeof authorizationServerMetadataSchema
>;

export function buildAuthorizationServerMetadata(
  origin: string,
): AuthorizationServerMetadata {
  return {
    issuer: origin,
    token_endpoint: `${origin}/oauth/token`,
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
    response_types_supported: [],
    scopes_supported: ["*"],
  };
}

export const protectedResourceMetadataSchema = z.object({
  resource: z.string().url(),
  authorization_servers: z.array(z.string().url()),
});

export type ProtectedResourceMetadata = z.infer<
  typeof protectedResourceMetadataSchema
>;

export function buildProtectedResourceMetadata(
  origin: string,
): ProtectedResourceMetadata {
  return {
    resource: origin,
    authorization_servers: [`${origin}/.well-known/oauth-authorization-server`],
  };
}
