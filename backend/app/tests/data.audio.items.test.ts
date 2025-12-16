import { expect } from "@std/expect";
import { dataAudioItemsHandler } from "@/routes/data.audio.items.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

Deno.test(
  "Data audio items handler: should return audio items when authenticated",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const startTime = new Date("2024-01-01T00:00:00.000Z").getTime().toString();
    const endTime = new Date("2024-01-02T00:00:00.000Z").getTime().toString();

    const response = await callExpressHandler(
      dataAudioItemsHandler,
      "http://localhost:3000/data/audio/items",
      {
        headers,
        query: { start: startTime, end: endTime },
      },
    );
    const data = await response.json();

    expect(data).toHaveProperty("items");
    expect(Array.isArray(data.items)).toBe(true);
  }),
);

Deno.test(
  "Data audio items handler: should require authentication",
  withFixtures([], async () => {
    const response = await callExpressHandler(
      dataAudioItemsHandler,
      "http://localhost:3000/data/audio/items",
    );
    expect(response.status).toBe(401);
  }),
);

Deno.test(
  "Data audio items handler: should handle missing date parameters",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      dataAudioItemsHandler,
      "http://localhost:3000/data/audio/items",
      { headers },
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required parameters");
  }),
);

Deno.test(
  "Data audio items handler: should handle invalid date parameters",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (headers: HeadersInit) => {
    const response = await callExpressHandler(
      dataAudioItemsHandler,
      "http://localhost:3000/data/audio/items",
      {
        headers,
        query: { start: "invalid-date", end: "1704153600000" },
      },
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid format");
  }),
);
