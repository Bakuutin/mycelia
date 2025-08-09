import { expect } from "@std/expect";
import { action as tokenAction } from "@/routes/oauth.token.ts";
import { loader as authServerLoader } from "@/routes/[.]well-known.oauth-authorization-server.ts";
import { loader as protectedResourceLoader } from "@/routes/[.]well-known.oauth-protected-resource.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";

const testOrigin = "http://localhost:3000";

function createMockLoaderArgs(url: string) {
  return {
    request: new Request(url),
    params: {},
    context: {},
  };
}

function createMockActionArgs(request: Request) {
  return {
    request,
    params: {},
    context: {},
  };
}

Deno.test(
  "OAuth Authorization Server Metadata loader: should return valid metadata",
  withFixtures([], async () => {
    const response = await authServerLoader(
      createMockLoaderArgs(
        `${testOrigin}/.well-known/oauth-authorization-server`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const metadata = await response.json();

    expect(metadata.issuer).toBe(testOrigin);
    expect(metadata.token_endpoint).toBe(`${testOrigin}/oauth/token`);
    expect(metadata.grant_types_supported).toEqual(["client_credentials"]);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual([
      "client_secret_basic",
      "client_secret_post",
    ]);
    expect(metadata.response_types_supported).toEqual([]);
    expect(metadata.scopes_supported).toEqual(["*"]);
  }),
);

Deno.test(
  "OAuth Protected Resource Metadata loader: should return valid metadata",
  withFixtures([], async () => {
    const response = await protectedResourceLoader(
      createMockLoaderArgs(
        `${testOrigin}/.well-known/oauth-protected-resource`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const metadata = await response.json();

    expect(metadata.resource).toBe(testOrigin);
    expect(metadata.authorization_servers).toEqual([
      `${testOrigin}/.well-known/oauth-authorization-server`,
    ]);
  }),
);

Deno.test(
  "OAuth Token action: should reject GET requests",
  withFixtures([], async () => {
    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "GET",
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(405);
  }),
);

Deno.test(
  "OAuth Token action: should reject invalid grant type",
  withFixtures([], async () => {
    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=authorization_code&client_secret=test_secret&client_id=foo",
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  }),
);

Deno.test(
  "OAuth Token action: should reject missing client_secret",
  withFixtures([], async () => {
    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&client_id=foo",
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  }),
);

Deno.test(
  "OAuth Token action: should reject missing client_id",
  withFixtures([], async () => {
    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_secret=foo",
    });

    const response = await tokenAction(createMockActionArgs(request));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  }),
);

Deno.test(
  "OAuth Token action: should reject invalid client_secret",
  withFixtures(["Mongo"], async () => {
    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&client_secret=invalid_secret&client_id=foo",
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("invalid_client");
  }),
);

Deno.test(
  "OAuth Token action: should issue token for valid client_secret via form data",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const { verifyApiKey } = await import("@/lib/auth/tokens.ts");
    const doc = await verifyApiKey(apiKey);
    const clientId = doc!._id!.toString();

    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&client_secret=${apiKey}&client_id=${clientId}`,
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const body = await response.json();
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toBe(86400);
    expect(body.scope).toBe("*");
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.length).toBeGreaterThan(0);
  }),
);

Deno.test(
  "OAuth Token action: should issue token for valid client_secret via Basic auth",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const { verifyApiKey } = await import("@/lib/auth/tokens.ts");
    const doc = await verifyApiKey(apiKey);
    const clientId = doc!._id!.toString();

    const credentials = btoa(`${clientId}:${apiKey}`);

    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: {
        "authorization": `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toBe(86400);
    expect(body.scope).toBe("*");
    expect(typeof body.access_token).toBe("string");
  }),
);

Deno.test(
  "OAuth Token action: should issue token for valid client_secret via JSON",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const { verifyApiKey } = await import("@/lib/auth/tokens.ts");
    const doc = await verifyApiKey(apiKey);
    const clientId = doc!._id!.toString();

    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_secret: apiKey,
        client_id: clientId,
      }),
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toBe(86400);
    expect(body.scope).toBe("*");
    expect(typeof body.access_token).toBe("string");
  }),
);

Deno.test(
  "OAuth Token action: should prefer body over Basic auth for client credentials",
  withFixtures(["TestApiKey", "Mongo"], async (validApiKey: string) => {
    const { verifyApiKey } = await import("@/lib/auth/tokens.ts");
    const doc = await verifyApiKey(validApiKey);
    const clientId = doc!._id!.toString();

    const credentials = btoa(`${clientId}:invalid_secret`);

    const request = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: {
        "authorization": `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&client_secret=${validApiKey}&client_id=${clientId}`,
    });

    const response = await tokenAction(createMockActionArgs(request));

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.token_type).toBe("bearer");
  }),
);

Deno.test(
  "OAuth Token action: should require client_id to equal principal when provided",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const { verifyApiKey } = await import("@/lib/auth/tokens.ts");
    const doc = await verifyApiKey(apiKey);

    const validClientId = doc!._id!.toString();

    const okReq = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_secret=${apiKey}&client_id=${validClientId}`,
    });
    const okRes = await tokenAction(createMockActionArgs(okReq));
    expect(okRes.status).toBe(200);

    const badReq = new Request(`${testOrigin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_secret=${apiKey}&client_id=some-other-id`
    });
    const badRes = await tokenAction(createMockActionArgs(badReq));
    expect(badRes.status).toBe(401);
    const badBody = await badRes.json();
    expect(badBody.error).toBe("invalid_client");
  }),
);
