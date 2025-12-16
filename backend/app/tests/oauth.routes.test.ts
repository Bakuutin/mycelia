import { expect } from "@std/expect";
import { oauthTokenHandler } from "@/routes/oauth.token.ts";
import { wellKnownOauthAuthorizationServerHandler } from "@/routes/[.]well-known.oauth-authorization-server.ts";
import { wellKnownOauthProtectedResourceHandler } from "@/routes/[.]well-known.oauth-protected-resource.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { verifyApiKey } from "@/lib/auth/tokens.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

const testOrigin = "http://localhost:3000";

Deno.test(
  "OAuth Authorization Server Metadata: should return valid metadata",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      wellKnownOauthAuthorizationServerHandler,
      `${testOrigin}/.well-known/oauth-authorization-server`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const metadata = await response.json();

    expect(metadata.issuer).toBe(testOrigin);
    expect(metadata.token_endpoint).toBe(`${testOrigin}/oauth/token`);
    expect(metadata.grant_types_supported).toContain("client_credentials");
    expect(metadata.token_endpoint_auth_methods_supported).toEqual([
      "client_secret_basic",
      "client_secret_post",
    ]);
    expect(metadata.response_types_supported).toEqual(["code"]);
    expect(metadata.scopes_supported).toEqual(["*"]);
  }),
);

Deno.test(
  "OAuth Protected Resource Metadata: should return valid metadata",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      wellKnownOauthProtectedResourceHandler,
      `${testOrigin}/.well-known/oauth-protected-resource`,
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
  "OAuth Token: should reject invalid grant type",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body:
          "grant_type=authorization_code&client_secret=test_secret&client_id=foo",
      },
    );

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  }),
);

Deno.test(
  "OAuth Token: should reject missing client_secret",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials&client_id=foo",
      },
    );

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  }),
);

Deno.test(
  "OAuth Token: should reject missing client_id",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_secret=foo",
      },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  }),
);

Deno.test(
  "OAuth Token: should reject invalid client_secret",
  withFixtures(["Mongo"], async () => {
    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body:
          "grant_type=client_credentials&client_secret=invalid_secret&client_id=foo",
      },
    );

    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("invalid_client");
  }),
);

Deno.test(
  "OAuth Token: should issue token for valid client_secret via form data",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const doc = await verifyApiKey(apiKey);
    const clientId = doc!._id!.toString();

    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body:
          `grant_type=client_credentials&client_secret=${apiKey}&client_id=${clientId}`,
      },
    );

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
  "OAuth Token: should issue token for valid client_secret via Basic auth",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const doc = await verifyApiKey(apiKey);
    const clientId = doc!._id!.toString();

    const credentials = btoa(`${clientId}:${apiKey}`);

    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: {
          "authorization": `Basic ${credentials}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toBe(86400);
    expect(body.scope).toBe("*");
    expect(typeof body.access_token).toBe("string");
  }),
);

Deno.test(
  "OAuth Token: should issue token for valid client_secret via JSON",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const doc = await verifyApiKey(apiKey);
    const clientId = doc!._id!.toString();

    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: {
          grant_type: "client_credentials",
          client_secret: apiKey,
          client_id: clientId,
        },
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.token_type).toBe("bearer");
    expect(body.expires_in).toBe(86400);
    expect(body.scope).toBe("*");
    expect(typeof body.access_token).toBe("string");
  }),
);

Deno.test(
  "OAuth Token: should prefer body over Basic auth for client credentials",
  withFixtures(["TestApiKey", "Mongo"], async (validApiKey: string) => {
    const doc = await verifyApiKey(validApiKey);
    const clientId = doc!._id!.toString();

    const credentials = btoa(`${clientId}:invalid_secret`);

    const response = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: {
          "authorization": `Basic ${credentials}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body:
          `grant_type=client_credentials&client_secret=${validApiKey}&client_id=${clientId}`,
      },
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.token_type).toBe("bearer");
  }),
);

Deno.test(
  "OAuth Token: should require client_id to equal principal when provided",
  withFixtures(["TestApiKey", "Mongo"], async (apiKey: string) => {
    const doc = await verifyApiKey(apiKey);

    const validClientId = doc!._id!.toString();

    const okRes = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body:
          `grant_type=client_credentials&client_secret=${apiKey}&client_id=${validClientId}`,
      },
    );
    expect(okRes.status).toBe(200);

    const badRes = await callExpressHandler(
      oauthTokenHandler,
      `${testOrigin}/oauth/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body:
          `grant_type=client_credentials&client_secret=${apiKey}&client_id=some-other-id`,
      },
    );
    expect(badRes.status).toBe(401);
    const badBody = await badRes.json();
    expect(badBody.error).toBe("invalid_client");
  }),
);
