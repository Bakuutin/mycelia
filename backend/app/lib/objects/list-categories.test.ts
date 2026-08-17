import { expect } from "@std/expect";
import {
  deriveObjectListCategories,
  legacyObjectListMatch,
  withObjectListCategories,
} from "./list-categories.ts";

Deno.test("deriveObjectListCategories preserves multi-section membership", () => {
  expect(deriveObjectListCategories({ isPerson: true, isEvent: true })).toEqual(
    ["person", "event"],
  );
  expect(deriveObjectListCategories({})).toEqual(["other"]);
});

Deno.test("promise and tag relationship records are excluded from relationship browse section", () => {
  expect(
    deriveObjectListCategories({ isRelationship: true, isPromise: true }),
  ).toEqual(["promise"]);
  expect(
    deriveObjectListCategories({ isRelationship: true, isTag: true }),
  ).toEqual(["tag"]);
});

Deno.test("withObjectListCategories replaces an untrusted materialized value", () => {
  expect(
    withObjectListCategories({
      name: "Amsterdam",
      isPlace: true,
      _listCategories: ["person"],
    })._listCategories,
  ).toEqual(["place"]);
});

Deno.test("legacy relationship and other predicates preserve existing semantics", () => {
  expect(legacyObjectListMatch("relationship")).toEqual({
    isRelationship: true,
    isPromise: { $ne: true },
    isTag: { $ne: true },
  });
  expect(legacyObjectListMatch("other")).toMatchObject({
    isPerson: { $ne: true },
    isRelationship: { $ne: true },
    isMedia: { $ne: true },
  });
});
