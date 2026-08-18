import { expect } from "@std/expect";
import { createSingleFlightBackoff } from "./query-backoff.ts";

Deno.test("single-flight shares one load for identical map queries", async () => {
  let resolveLoad!: (value: number[]) => void;
  const pending = new Promise<number[]>((resolve) => {
    resolveLoad = resolve;
  });
  let loads = 0;
  const run = createSingleFlightBackoff<number[]>({
    backoffMs: 60_000,
    isDeadlineError: () => false,
  });

  const first = run("same-window", () => {
    loads++;
    return pending;
  });
  const second = run("same-window", () => {
    loads++;
    return Promise.resolve([2]);
  });
  resolveLoad([1]);

  expect(await first).toEqual([1]);
  expect(await second).toEqual([1]);
  expect(loads).toBe(1);
});

Deno.test("deadline starts backoff without rerunning the query", async () => {
  let currentTime = 1_000;
  let loads = 0;
  const run = createSingleFlightBackoff<number[]>({
    backoffMs: 60_000,
    isDeadlineError: (error) => (error as { code?: number }).code === 50,
    now: () => currentTime,
  });
  const deadline = Object.assign(new Error("deadline"), { code: 50 });

  await expect(
    run("same-window", () => {
      loads++;
      return Promise.reject(deadline);
    }),
  ).rejects.toThrow("deadline");
  await expect(
    run("same-window", () => {
      loads++;
      return Promise.resolve([2]);
    }),
  ).rejects.toThrow("timeout backoff");
  expect(loads).toBe(1);

  currentTime += 60_001;
  expect(
    await run("same-window", () => {
      loads++;
      return Promise.resolve([3]);
    }),
  ).toEqual([3]);
  expect(loads).toBe(2);
});
