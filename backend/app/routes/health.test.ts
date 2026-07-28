import { expect } from "@std/expect";
import { getServiceReadiness, setServiceReady } from "./health.ts";

Deno.test("service readiness changes only when startup marks it ready", () => {
  setServiceReady(false);
  expect(getServiceReadiness()).toBe("starting");

  setServiceReady(true);
  expect(getServiceReadiness()).toBe("ready");

  setServiceReady(false);
});
