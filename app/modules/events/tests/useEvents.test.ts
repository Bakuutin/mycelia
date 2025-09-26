import { expect } from "@std/expect";
import { zEventsQuery } from "@/types/events.ts";

Deno.test("zEventsQuery validates basic range", () => {
  const now = new Date();
  const later = new Date(now.getTime() + 1000);
  const parsed = zEventsQuery.parse({ start: now, end: later });
  expect(parsed.start instanceof Date).toBe(true);
  expect(parsed.end instanceof Date).toBe(true);
});


