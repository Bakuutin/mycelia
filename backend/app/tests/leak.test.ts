import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";

Deno.test(
  "withFixtures should not leak",
  withFixtures([
  ], async () => {
    expect(true).toBe(true);
  }),
);

Deno.test(
  "Deno.test should not leak",
  async () => {
    expect(withFixtures).toBeDefined();
  }
);
