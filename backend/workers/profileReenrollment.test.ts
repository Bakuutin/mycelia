import { expect } from "@std/expect";
import profileReenrollment from "./profileReenrollment.ts";

Deno.test("profile re-enrollment can download its saved GridFS samples", () => {
  expect(profileReenrollment.policies).toContainEqual({
    resource: "fs/voice_samples",
    action: "download",
    effect: "allow",
  });
});
