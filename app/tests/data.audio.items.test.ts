import { expect } from "@std/expect";
import { loader } from "@/routes/data.audio.items.tsx";
import { withFixtures } from "@/tests/fixtures.server.ts";

function createMockLoaderArgs(url: string, headers?: HeadersInit) {
  return {
    request: new Request(url, { headers }),
    params: {},
    context: {},
  };
}

Deno.test(
  "Data audio items loader: should return audio items when authenticated",
  withFixtures(["TestApiKey"], async (token: string) => {
    const url = new URL("http://localhost:3000/data/audio/items");
    url.searchParams.set("start", "2024-01-01T00:00:00.000Z");
    url.searchParams.set("end", "2024-01-02T00:00:00.000Z");

    const response = await loader(
      createMockLoaderArgs(url.toString(), {
        "Authorization": `Bearer ${token}`,
      }),
    );
    const data = await response.json();

    expect(Array.isArray(data)).toBe(true);
  }),
);

Deno.test(
  "Data audio items loader: should require authentication",
  withFixtures([], async () => {
    try {
      await loader(createMockLoaderArgs("http://localhost:3000/data/audio/items"));
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(401);
    }
  }),
);

Deno.test(
  "Data audio items loader: should handle missing date parameters",
  withFixtures(["TestApiKey"], async (token: string) => {
    const response = await loader(
      createMockLoaderArgs("http://localhost:3000/data/audio/items", {
        "Authorization": `Bearer ${token}`,
      }),
    );
    const data = await response.json();

    expect(Array.isArray(data)).toBe(true);
  }),
);

Deno.test(
  "Data audio items loader: should handle invalid date parameters",
  withFixtures(["TestApiKey"], async (token: string) => {
    const url = new URL("http://localhost:3000/data/audio/items");
    url.searchParams.set("start", "invalid-date");

    try {
      await loader(
        createMockLoaderArgs(url.toString(), {
          "Authorization": `Bearer ${token}`,
        }),
      );
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(400);
    }
  }),
);

Deno.test(
  "Data audio items loader: should limit results",
  withFixtures(["TestApiKey"], async (token: string) => {
    const url = new URL("http://localhost:3000/data/audio/items");
    url.searchParams.set("limit", "5");

    const response = await loader(
      createMockLoaderArgs(url.toString(), {
        "Authorization": `Bearer ${token}`,
      }),
    );
    const data = await response.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(5);
  }),
);