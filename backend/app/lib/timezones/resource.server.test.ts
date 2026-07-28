import { expect } from "@std/expect";
import {
  isValidTimeZone,
  timelineTimeZonesRequestSchema,
} from "./resource.server.ts";

Deno.test("timeline time zone validation accepts IANA zones", () => {
  expect(isValidTimeZone("Europe/Paris")).toBe(true);
  expect(isValidTimeZone("Asia/Tbilisi")).toBe(true);
  expect(isValidTimeZone("Not/A_Time_Zone")).toBe(false);
});

Deno.test("timeline time zone periods require an increasing range", () => {
  const result = timelineTimeZonesRequestSchema.safeParse({
    action: "create",
    period: {
      start: "2026-07-28T12:00:00.000Z",
      end: "2026-07-28T11:00:00.000Z",
      timeZone: "Europe/Paris",
    },
  });

  expect(result.success).toBe(false);
});

Deno.test("timeline time zone periods preserve import provenance", () => {
  const result = timelineTimeZonesRequestSchema.parse({
    action: "create",
    period: {
      start: "2026-07-28T10:00:00.000Z",
      end: "2026-07-28T11:00:00.000Z",
      timeZone: "Europe/Paris",
      location: { name: "Metz" },
      source: "metadata",
      metadata: { provider: "photo-exif" },
    },
  });

  if (result.action !== "create") throw new Error("Expected create action");
  expect(result.period.source).toBe("metadata");
  expect(result.period.location?.name).toBe("Metz");
});

Deno.test("timeline time zone periods accept null location from EJSON clients", () => {
  const result = timelineTimeZonesRequestSchema.parse({
    action: "create",
    period: {
      start: "2026-07-28T10:00:00.000Z",
      end: "2026-07-28T11:00:00.000Z",
      timeZone: "Asia/Bangkok",
      location: null,
    },
  });

  if (result.action !== "create") throw new Error("Expected create action");
  expect(result.period.location).toBe(undefined);
});
