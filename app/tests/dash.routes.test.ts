import { expect } from "@std/expect";
import { loader as dashLoader } from "@/routes/_dash.tsx";
import { withFixtures } from "@/tests/fixtures.server.ts";

function createMockLoaderArgs(url: string, headers?: HeadersInit) {
  return {
    request: new Request(url, { headers }),
    params: {},
    context: {},
  };
}

Deno.test(
  "Dash layout loader: should return auth data when authenticated",
  withFixtures(["TestApiKey"], async (token: string) => {
    const response = await dashLoader(
      createMockLoaderArgs("http://localhost:3000/", {
        "Authorization": `Bearer ${token}`,
      }),
    );
    const data = await response.json();

    expect(data).toHaveProperty("auth");
    expect(data.auth).toHaveProperty("principal");
    expect(data.auth.principal).toBe("test-owner");
  }),
);

Deno.test(
  "Dash layout loader: should redirect when not authenticated",
  withFixtures([], async () => {
    const response = await dashLoader(
      createMockLoaderArgs("http://localhost:3000/"),
    );
    
    // Should redirect to login
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/login");
  }),
);



