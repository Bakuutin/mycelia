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
    const data = await dashLoader(
      createMockLoaderArgs("http://localhost:3000/", {
        "Authorization": `Bearer ${token}`,
      }),
    );

    expect(data).toHaveProperty("auth");
    expect(data.auth).toHaveProperty("principal");
    expect(data.auth.principal).toBe("test-owner");
  }),
);

Deno.test(
  "Dash layout loader: should redirect when not authenticated",
  withFixtures([], async () => {
    try {
      await dashLoader(
        createMockLoaderArgs("http://localhost:3000/"),
      );
      expect(false).toBe(true); // Should not reach here
    } catch (response: any) {
      // Should redirect to login
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toContain("/login");
    }
  }),
);
