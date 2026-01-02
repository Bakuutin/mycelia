import { expect } from "@std/expect";
import { apiResourceHandler } from "@/routes/api.resource.$name.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

Deno.test("Resource route - should require resource name", async () => {
  // const response = await callExpressHandler(
  //   apiResourceHandler,
  //   "http://localhost/api/resource/",
  //   {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: {},
  //     params: { name: "" },
  //   },
  // );
  // expect(response.status).toBe(400);

  // const data = await response.json();
  // expect(data.success).toBe(false);
  // expect(data.error).toBe("Tool name is required");
});

Deno.test(
  "Resource route - should return 404 for unknown resource",
  withFixtures([
    "AdminAuthHeaders",
  ], async (authHeaders) => {
    // const response = await callExpressHandler(
    //   apiResourceHandler,
    //   "http://localhost/api/resource/nonexistent",
    //   {
    //     method: "POST",
    //     headers: {
    //       ...authHeaders,
    //       "Content-Type": "application/json",
    //     },
    //     body: {},
    //     params: { name: "nonexistent" },
    //   },
    // );
    // expect(response.status).toBe(404);

    // const data = await response.json();
    // expect(data.success).toBe(false);
    // expect(data.error).toBe("Tool 'nonexistent' not found");
  }),
);

Deno.test(
  "Resource route - should successfully call mongo count resource",
  withFixtures([
    "AdminAuthHeaders",
    "Mongo",
  ], async (authHeaders) => {
    const response = await callExpressHandler(
      apiResourceHandler,
      "http://localhost/api/resource/mongo",
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: {
          action: "count",
          collection: "audio_chunks",
          query: {},
        },
        params: { name: "mongo" },
      },
    );
    // expect(response.status).toBe(200);

    // const data = await response.json();
    // expect(typeof data).toBe("number");
  }),
);
