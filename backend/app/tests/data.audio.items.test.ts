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
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const url = new URL("http://localhost:3000/data/audio/items");
    url.searchParams.set(
      "start",
      new Date("2024-01-01T00:00:00.000Z").getTime().toString(),
    );
    url.searchParams.set(
      "end",
      new Date("2024-01-02T00:00:00.000Z").getTime().toString(),
    );

    const response = await loader(
      createMockLoaderArgs(url.toString(), headers),
    );
    const data = await response.json();

    expect(data).toHaveProperty("items");
    expect(Array.isArray(data.items)).toBe(true);
  }),
);

Deno.test(
  "Data audio items loader: should require authentication",
  withFixtures([], async () => {
    try {
      await loader(
        createMockLoaderArgs("http://localhost:3000/data/audio/items"),
      );
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(401);
    }
  }),
);

Deno.test(
  "Data audio items loader: should handle missing date parameters",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await loader(
      createMockLoaderArgs("http://localhost:3000/data/audio/items", headers),
    );
    const data = await response.json();

    expect(data).toHaveProperty("items");
    expect(Array.isArray(data.items)).toBe(true);
  }),
);

Deno.test(
  "Data audio items loader: should handle invalid date parameters",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const url = new URL("http://localhost:3000/data/audio/items");
    url.searchParams.set("start", "invalid-date");

    try {
      await loader(
        createMockLoaderArgs(url.toString(), headers),
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
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const url = new URL("http://localhost:3000/data/audio/items");
    url.searchParams.set("limit", "5");

    const response = await loader(
      createMockLoaderArgs(url.toString(), headers),
    );
    const data = await response.json();

    expect(data).toHaveProperty("items");
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeLessThanOrEqual(5);
  }),
);
