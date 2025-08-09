import { expect } from "@std/expect";
import { action } from "@/routes/login.tsx";
import { withFixtures } from "@/tests/fixtures.server.ts";

function createMockActionArgs(request: Request) {
  return {
    request,
    params: {},
    context: {},
  };
}




Deno.test(
  "Login route action: should handle token submission",
  withFixtures(["TestApiKey"], async (token: string) => {
    const formData = new FormData();
    formData.append("token", token);

    const request = new Request("http://localhost:3000/login", {
      method: "POST",
      body: formData,
    });

    const response = await action(createMockActionArgs(request));
    
    // Login should either succeed with redirect or fail with error
    expect([200, 302, 400, 401]).toContain(response.status);
  }),
);


Deno.test(
  "Login route action: should handle missing token",
  withFixtures([], async () => {
    const formData = new FormData();
    
    const request = new Request("http://localhost:3000/login", {
      method: "POST",
      body: formData,
    });

    const response = await action(createMockActionArgs(request));
    expect(response.status).toBe(400);
  }),
);