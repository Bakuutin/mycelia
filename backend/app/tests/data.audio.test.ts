import { expect } from "@std/expect";
import { loader } from "@/routes/data.audio.tsx";
import { withFixtures } from "@/tests/fixtures.server.ts";

function createMockLoaderArgs(url: string, headers?: HeadersInit) {
  return {
    request: new Request(url, { headers }),
    params: {},
    context: {},
  };
}

Deno.test(
  "Data audio loader: should return segments when authenticated",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const url = new URL("http://localhost:3000/data/audio");
    url.searchParams.set("start", "2024-01-01T00:00:00.000Z");

    const data = await loader(
      createMockLoaderArgs(url.toString(), headers),
    );

    expect(data).toHaveProperty("segments");
    expect(Array.isArray(data.segments)).toBe(true);
  }),
);

Deno.test(
  "Data audio loader: should require authentication",
  withFixtures([], async () => {
    try {
      await loader(createMockLoaderArgs("http://localhost:3000/data/audio"));
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(401);
    }
  }),
);

Deno.test(
  "Data audio loader: should handle missing start parameter",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    try {
      await loader(
        createMockLoaderArgs("http://localhost:3000/data/audio", headers),
      );
      expect(false).toBe(true); // Should not reach here - start is required
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(400);
    }
  }),
);

Deno.test(
  "Data audio loader: should handle invalid date parameters",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const url = new URL("http://localhost:3000/data/audio");
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
