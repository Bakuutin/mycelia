import { expect } from "@std/expect";
import {
  buildCatalogValidationPipeline,
  repairObjectListCatalog,
} from "./list-catalog.ts";
import { OBJECT_LIST_CATEGORIES } from "./list-categories.ts";

Deno.test("catalog validation uses one bounded aggregate scan", async () => {
  const calls: any[] = [];
  const zeroParity = Object.fromEntries(
    OBJECT_LIST_CATEGORIES.flatMap((category) => [
      [`legacy_${category}`, 0],
      [`catalog_${category}`, 0],
    ]),
  );
  const mongo = async (input: any) => {
    calls.push(input);
    if (input.action === "findOne") return null;
    if (input.action === "find") return [];
    if (input.action === "aggregate") {
      return [{ missing: 0, mismatched: 0, ...zeroParity }];
    }
    return { modifiedCount: 1 };
  };

  const result = await repairObjectListCatalog(mongo, 1000);

  expect(result.ready).toBe(true);
  expect(calls.filter((call) => call.action === "aggregate")).toHaveLength(1);
  expect(calls.filter((call) => call.action === "count")).toHaveLength(0);
  expect(calls.find((call) => call.action === "aggregate").options).toEqual({
    maxTimeMS: 8_000,
  });
});

Deno.test("catalog validation pipeline computes mismatch and parity together", () => {
  const pipeline = buildCatalogValidationPipeline();
  expect(pipeline).toHaveLength(2);
  expect(pipeline[0].$project.expectedCategories).toBeDefined();
  expect(pipeline[1].$group.missing).toBeDefined();
  expect(pipeline[1].$group.mismatched.$sum.$cond[0]).toEqual({
    $ne: ["$catalogCategories", "$expectedCategories"],
  });
  expect(pipeline[1].$group.legacy_person).toBeDefined();
  expect(pipeline[1].$group.catalog_person).toBeDefined();
});
