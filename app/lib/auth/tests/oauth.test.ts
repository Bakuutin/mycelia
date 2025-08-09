import { expect } from "@std/expect";
import {
  authorizationServerMetadataSchema,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  extractClientCredentials,
  oauthErrorJson,
  protectedResourceMetadataSchema,
  tokenRequestSchema,
} from "../oauth.ts";

Deno.test("extractClientCredentials: should extract from Basic auth header", async () => {
  const credentials = "client_id:client_secret";
  const encoded = btoa(credentials);
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "authorization": `Basic ${encoded}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("client_id");
  expect(result.clientSecret).toBe("client_secret");
  expect(result.grantType).toBe("client_credentials");
  expect(result.scope).toBe(null);
});

Deno.test("extractClientCredentials: should extract from request body form data", async () => {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=client_credentials&client_id=test_id&client_secret=test_secret&scope=read",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("test_id");
  expect(result.clientSecret).toBe("test_secret");
  expect(result.grantType).toBe("client_credentials");
  expect(result.scope).toBe("read");
});

Deno.test("extractClientCredentials: should extract from JSON body", async () => {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: "json_id",
      client_secret: "json_secret",
      scope: "write",
    }),
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("json_id");
  expect(result.clientSecret).toBe("json_secret");
  expect(result.grantType).toBe("client_credentials");
  expect(result.scope).toBe("write");
});

Deno.test("extractClientCredentials: should prefer body over header for credentials", async () => {
  const headerCredentials = "header_id:header_secret";
  const encoded = btoa(headerCredentials);
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "authorization": `Basic ${encoded}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=client_credentials&client_id=body_id&client_secret=body_secret",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("body_id");
  expect(result.clientSecret).toBe("body_secret");
  expect(result.grantType).toBe("client_credentials");
});

Deno.test("extractClientCredentials: should prefer body over header when header missing client data", async () => {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "authorization": "Bearer some_token",
      "content-type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=client_credentials&client_id=body_id&client_secret=body_secret",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("body_id");
  expect(result.clientSecret).toBe("body_secret");
  expect(result.grantType).toBe("client_credentials");
});

Deno.test("extractClientCredentials: should handle malformed Basic auth header", async () => {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "authorization": "Basic invalid_base64",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("");
  expect(result.clientSecret).toBe("");
  expect(result.grantType).toBe("client_credentials");
});

Deno.test("extractClientCredentials: should handle missing credentials", async () => {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("");
  expect(result.clientSecret).toBe("");
  expect(result.grantType).toBe("client_credentials");
  expect(result.scope).toBe(null);
});

Deno.test("oauthErrorJson: should return error response with default status", () => {
  const response = oauthErrorJson("invalid_request");

  expect(response.status).toBe(400);
  expect(response.headers.get("content-type")).toBe("application/json");
});

Deno.test("oauthErrorJson: should return error response with custom status", () => {
  const response = oauthErrorJson("invalid_client", 401);

  expect(response.status).toBe(401);
});

Deno.test("oauthErrorJson: should return JSON body with error", async () => {
  const response = oauthErrorJson("invalid_grant");
  const body = await response.json();

  expect(body).toEqual({ error: "invalid_grant" });
});

Deno.test("tokenRequestSchema: should validate valid token request", () => {
  const validRequest = {
    grant_type: "client_credentials" as const,
    client_secret: "test_secret",
    client_id: "test_id",
  };

  const result = tokenRequestSchema.safeParse(validRequest);

  expect(result.success).toBe(true);
  expect(result.data).toEqual(validRequest);
});

Deno.test("tokenRequestSchema: should reject invalid grant type", () => {
  const invalidRequest = {
    grant_type: "authorization_code",
    client_secret: "test_secret",
  };

  const result = tokenRequestSchema.safeParse(invalidRequest);

  expect(result.success).toBe(false);
});

Deno.test("tokenRequestSchema: should reject missing client_secret", () => {
  const invalidRequest = {
    grant_type: "client_credentials" as const,
  };

  const result = tokenRequestSchema.safeParse(invalidRequest);

  expect(result.success).toBe(false);
});

Deno.test("buildAuthorizationServerMetadata: should create valid metadata", () => {
  const origin = "https://example.com";
  const metadata = buildAuthorizationServerMetadata(origin);

  expect(metadata.issuer).toBe(origin);
  expect(metadata.token_endpoint).toBe(`${origin}/oauth/token`);
  expect(metadata.grant_types_supported).toEqual(["client_credentials"]);
  expect(metadata.token_endpoint_auth_methods_supported).toEqual([
    "client_secret_basic",
    "client_secret_post",
  ]);
  expect(metadata.response_types_supported).toEqual([]);
  expect(metadata.scopes_supported).toEqual(["*"]);
});

Deno.test("authorizationServerMetadataSchema: should validate generated metadata", () => {
  const metadata = buildAuthorizationServerMetadata("https://example.com");
  const result = authorizationServerMetadataSchema.safeParse(metadata);

  expect(result.success).toBe(true);
});

Deno.test("authorizationServerMetadataSchema: should reject invalid issuer", () => {
  const invalidMetadata = {
    issuer: "not-a-url",
    token_endpoint: "https://example.com/oauth/token",
    grant_types_supported: ["client_credentials"] as const,
    token_endpoint_auth_methods_supported: ["client_secret_basic"] as const,
    response_types_supported: [],
    scopes_supported: ["*"],
  };

  const result = authorizationServerMetadataSchema.safeParse(invalidMetadata);

  expect(result.success).toBe(false);
});

Deno.test("buildProtectedResourceMetadata: should create valid metadata", () => {
  const origin = "https://example.com";
  const metadata = buildProtectedResourceMetadata(origin);

  expect(metadata.resource).toBe(origin);
  expect(metadata.authorization_servers).toEqual([
    `${origin}/.well-known/oauth-authorization-server`,
  ]);
});

Deno.test("protectedResourceMetadataSchema: should validate generated metadata", () => {
  const metadata = buildProtectedResourceMetadata("https://example.com");
  const result = protectedResourceMetadataSchema.safeParse(metadata);

  expect(result.success).toBe(true);
});

Deno.test("protectedResourceMetadataSchema: should reject invalid resource URL", () => {
  const invalidMetadata = {
    resource: "not-a-url",
    authorization_servers: [
      "https://example.com/.well-known/oauth-authorization-server",
    ],
  };

  const result = protectedResourceMetadataSchema.safeParse(invalidMetadata);

  expect(result.success).toBe(false);
});

Deno.test("extractClientCredentials: should handle empty request body", async () => {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("");
  expect(result.clientSecret).toBe("");
  expect(result.grantType).toBe(null);
  expect(result.scope).toBe(null);
});

Deno.test("extractClientCredentials: should handle malformed JSON body", async () => {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: "invalid json",
  });

  await expect(extractClientCredentials(request)).rejects.toThrow();
});

Deno.test("extractClientCredentials: should handle Basic auth with colon in password", async () => {
  const credentials = "client_id:password:with:colons";
  const encoded = btoa(credentials);
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "authorization": `Basic ${encoded}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("client_id");
  expect(result.clientSecret).toBe("password");
});

Deno.test("extractClientCredentials: should handle Basic auth with missing password", async () => {
  const credentials = "client_id_only";
  const encoded = btoa(credentials);
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    headers: {
      "authorization": `Basic ${encoded}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const result = await extractClientCredentials(request);

  expect(result.clientId).toBe("");
  expect(result.clientSecret).toBe("");
});
