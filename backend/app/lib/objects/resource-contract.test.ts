import { expect } from "@std/expect";
import { ObjectsResource } from "./resource.server.ts";

const requestSchema = new ObjectsResource().schemas.request;

Deno.test("bounded Objects actions normalize EJSON null optionals", () => {
  const listCards = requestSchema.parse({
    action: "listCards",
    section: "person",
    filters: {
      search: null,
      tagIds: null,
      tagMode: "and",
      orphanedOnly: null,
    },
    sort: "updatedAt",
    cursor: null,
    limit: 9,
  });
  if (listCards.action !== "listCards") {
    throw new Error("Expected listCards request");
  }
  expect(listCards.filters?.search).toBeUndefined();
  expect(listCards.filters?.tagIds).toBeUndefined();
  expect(listCards.filters?.tagMode).toBe("and");
  expect(listCards.filters?.orphanedOnly).toBeUndefined();
  expect(listCards.cursor).toBeUndefined();

  const tagOptions = requestSchema.parse({
    action: "listTagOptions",
    ids: null,
    search: null,
    limit: null,
  });
  if (tagOptions.action !== "listTagOptions") {
    throw new Error("Expected listTagOptions request");
  }
  expect(tagOptions.ids).toBeUndefined();
  expect(tagOptions.search).toBeUndefined();
  expect(tagOptions.limit).toBe(32);

  const density = requestSchema.parse({
    action: "getDensity",
    start: "2026-08-01T00:00:00.000Z",
    end: "2026-08-02T00:00:00.000Z",
    resolution: null,
    categories: null,
  });
  if (density.action !== "getDensity") {
    throw new Error("Expected getDensity request");
  }
  expect(density.resolution).toBeUndefined();
  expect(density.categories).toBeUndefined();

  const repair = requestSchema.parse({
    action: "repairListCatalog",
    batchSize: null,
  });
  if (repair.action !== "repairListCatalog") {
    throw new Error("Expected repairListCatalog request");
  }
  expect(repair.batchSize).toBe(1000);
});
