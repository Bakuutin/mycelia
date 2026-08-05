import { expect } from "@std/expect";
import { ObjectId } from "bson";
import {
  buildUntypedScanFilters,
  canRewriteDoc,
  formatEntitiesForPrompt,
  parseTypingResponse,
  schema,
} from "./entityTyping.ts";
import {
  hasAnyTypeFlagKey,
  TYPE_FLAG_FIELDS,
} from "./conversationExtractor.ts";

Deno.test("entity typing defaults batch many entities per LLM call", () => {
  const input = schema.parse({ type: "entity_typing" });
  expect(input.limit).toBe(200);
  expect(input.batchSize).toBe(40);
  expect(input.force).toBe(false);
  expect(input.model).toBe("small");
  expect(input.typing_system_prompt).toContain("classifications");
});

Deno.test("untyped scan skips every existing type-flag key and prior attempts", () => {
  const filters = buildUntypedScanFilters(false);
  for (const field of TYPE_FLAG_FIELDS) {
    expect(filters[field]).toEqual({ $exists: false });
  }
  expect(filters["metadata.aiProvenance.entityTyping"]).toEqual({
    $exists: false,
  });

  const forced = buildUntypedScanFilters(true);
  expect(forced["metadata.aiProvenance.entityTyping"]).toBeUndefined();
  expect(forced.isPerson).toEqual({ $exists: false });
});

Deno.test("explicit false flags count as a manual typing decision", () => {
  expect(hasAnyTypeFlagKey({ name: "X" })).toBe(false);
  expect(hasAnyTypeFlagKey({ name: "X", isPerson: false })).toBe(true);
  expect(hasAnyTypeFlagKey({ name: "X", isPlace: true })).toBe(true);
});

Deno.test("force rewrites only flags this worker set itself", () => {
  const untyped = { _id: new ObjectId(), name: "X" };
  expect(canRewriteDoc(untyped, false)).toBe(true);

  const userTyped = { _id: new ObjectId(), name: "X", isPerson: true };
  expect(canRewriteDoc(userTyped, false)).toBe(false);
  expect(canRewriteDoc(userTyped, true)).toBe(false);

  const workerTyped = {
    _id: new ObjectId(),
    name: "X",
    isPlace: true,
    metadata: { aiProvenance: { entityTyping: { setFlag: "isPlace" } } },
  };
  expect(canRewriteDoc(workerTyped, false)).toBe(false);
  expect(canRewriteDoc(workerTyped, true)).toBe(true);

  // A user toggle added on top of the worker's flag blocks force rewrites.
  const mixed = {
    _id: new ObjectId(),
    name: "X",
    isPlace: true,
    isPerson: true,
    metadata: { aiProvenance: { entityTyping: { setFlag: "isPlace" } } },
  };
  expect(canRewriteDoc(mixed, true)).toBe(false);
});

Deno.test("prompt formatter includes ids, aliases and truncated details", () => {
  const id = new ObjectId();
  const formatted = formatEntitiesForPrompt([
    {
      _id: id,
      name: "Шуши",
      aliases: ["Shushi"],
      details: "x".repeat(500),
    },
  ]);
  const parsed = JSON.parse(formatted);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].id).toBe(id.toString());
  expect(parsed[0].name).toBe("Шуши");
  expect(parsed[0].aliases).toEqual(["Shushi"]);
  expect(parsed[0].details.length).toBe(200);
});

Deno.test("typing response parser drops unknown ids and invalid types", () => {
  const idA = new ObjectId().toString();
  const idB = new ObjectId().toString();
  const validIds = new Set([idA, idB]);

  const result = parseTypingResponse(
    JSON.stringify({
      classifications: [
        { id: idA, type: "person" },
        { id: idB, type: "sandwich" },
        { id: new ObjectId().toString(), type: "place" },
        { id: idA, type: "organization" },
      ],
    }),
    validIds,
  );

  expect(result.get(idA)).toBe("person"); // first classification wins
  expect(result.has(idB)).toBe(false); // invalid type dropped
  expect(result.size).toBe(1);
});

Deno.test("typing response parser handles fenced JSON", () => {
  const id = new ObjectId().toString();
  const result = parseTypingResponse(
    "```json\n" +
      JSON.stringify({ classifications: [{ id, type: "place" }] }) +
      "\n```",
    new Set([id]),
  );
  expect(result.get(id)).toBe("place");
});
