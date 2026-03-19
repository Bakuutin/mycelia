import { expect } from "@std/expect";
import { schema } from "./conversationExtractor.ts";
import { STRUCTURED_ANALYZE_CONVERSATION_DETAILS_PROMPT } from "@/lib/prompts/conversationExtractor.ts";

Deno.test("conversation extractor defaults to the structured metadata extraction prompt", () => {
  const parsed = schema.parse({ type: "conversation_extractor" });
  expect(parsed.extraction_system_prompt).toBe(
    STRUCTURED_ANALYZE_CONVERSATION_DETAILS_PROMPT,
  );
});
