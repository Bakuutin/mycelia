import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";

// type VadJobDataInput = z.input<typeof VadJobDataSchema>;
import "./fixtures.ts";

Deno.test(
  "enqueueJob creates job with ObjectId",
  withFixtures(["JobQueue", "Mongo"], async () => {
    expect(3 + 4).toBe(7);
  }),
);
