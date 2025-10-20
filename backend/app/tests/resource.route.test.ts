import { expect } from "@std/expect";
import { action } from "@/routes/api.resource.$name.tsx";
import { withFixtures } from "@/tests/fixtures.server.ts";

Deno.test("Resource route - should require POST method", async () => {
  const request = new Request("http://localhost/api/resource/test", {
    method: "GET",
  });
  const params = { name: "test" };

  const response = await action({ request, params } as any);
  expect(response.status).toBe(405);
});

Deno.test("Resource route - should require resource name", async () => {
  const request = new Request("http://localhost/api/resource/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const params = { name: undefined };

  const response = await action({ request, params } as any);
  expect(response.status).toBe(400);

  const data = await response.json();
  expect(data.success).toBe(false);
  expect(data.error).toBe("Tool name is required");
});

Deno.test(
  "Resource route - should return 404 for unknown resource",
  withFixtures([
    "AdminAuthHeaders",
  ], async (authHeaders) => {
    const request = new Request("http://localhost/api/resource/nonexistent", {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const params = { name: "nonexistent" };

    const response = await action({ request, params } as any);
    expect(response.status).toBe(404);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Tool 'nonexistent' not found");
  }),
);

Deno.test(
  "Resource route - should successfully call mongo count resource",
  withFixtures([
    "AdminAuthHeaders",
    "Mongo",
  ], async (authHeaders) => {
    const request = new Request(
      "http://localhost/api/resource/tech.mycelia.mongo",
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "count",
          collection: "audio_chunks",
          query: {},
        }),
      },
    );
    const params = { name: "tech.mycelia.mongo" };

    const response = await action({ request, params } as any);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(typeof data).toBe("number");
  }),
);
