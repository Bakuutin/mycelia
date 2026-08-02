import { expect } from "@std/expect";
import { OPENROUTER_BATCH_MODEL, schema } from "./openrouter_batch.ts";

Deno.test("OpenRouter batch pilot is fixed to DeepSeek V4 Flash and bounded to 100 items", () => {
  const parsed = schema.parse({
    type: "openrouter_batch",
    action: "dry_run",
    prompt: "Summarize the conversation.",
  });
  expect(parsed.model).toBe(OPENROUTER_BATCH_MODEL);
  expect(parsed.limit).toBe(100);

  const tooMany = schema.safeParse({
    type: "openrouter_batch",
    action: "submit",
    prompt: "Summarize the conversation.",
    objectIds: Array.from({ length: 101 }, (_, index) => `${index}`),
  });
  expect(tooMany.success).toBe(false);
});
