import { expect } from "@std/expect";
import { dataAudioHandler } from "@/routes/data.audio.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

Deno.test(
  "Data audio handler: should return segments when authenticated",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      dataAudioHandler,
      "http://localhost:3000/data/audio?start=1704067200000",
      { headers },
    );
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toHaveProperty("segments");
    expect(Array.isArray(data.segments)).toBe(true);
  }),
);

Deno.test(
  "Data audio handler: should require authentication",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      dataAudioHandler,
      "http://localhost:3000/data/audio",
    );
    expect(response.status).toBe(401);
  }),
);

Deno.test(
  "Data audio handler: should handle missing start parameter",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      dataAudioHandler,
      "http://localhost:3000/data/audio",
      { headers },
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required 'start' parameter");
  }),
);

Deno.test(
  "Data audio handler: should handle invalid date parameters",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      dataAudioHandler,
      "http://localhost:3000/data/audio?start=invalid-timestamp",
      { headers },
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid start parameter");
  }),
);
