import { expect } from "@std/expect";
import { schema } from "./enrollment.ts";

Deno.test("enrollment accepts an authoritative profile id", () => {
  const parsed = schema.parse({
    type: "enrollment",
    name: "Sky",
    profile_id: "698349a50dadb6125cb83312",
    sample_file_id: "698349a50dadb6125cb83313",
  });

  expect(parsed.profile_id).toBe("698349a50dadb6125cb83312");
});
