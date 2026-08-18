import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.15";
import { runExactCount } from "./exact-count.ts";

Deno.test("runExactCount returns an unavailable result for a Mongo deadline", async () => {
  const result = await runExactCount(
    () => Promise.reject({ code: 50, codeName: "MaxTimeMSExpired" }),
    15,
  );

  assertEquals(result, {
    value: null,
    status: "timeout",
    warning:
      "Exact count exceeded its 15-second MongoDB limit; retry the snapshot after the database load falls.",
  });
});

Deno.test("runExactCount does not hide non-deadline failures", async () => {
  await assertRejects(
    () => runExactCount(() => Promise.reject(new Error("network down")), 5),
    Error,
    "network down",
  );
});
