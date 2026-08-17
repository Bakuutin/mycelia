import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getObjectsResource } from "./resource.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { OBJECT_LIST_INDEXES } from "../../../migrations/0051_object_list_catalog.ts";

async function warmMongo(db: any): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await db.command({ ping: 1 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

Deno.test(
  "object list catalog preserves section semantics and cursor pagination",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    await warmMongo(db);
    await Promise.all([
      db.collection("objects").createIndex(
        { "relationship.subject": 1 },
        { name: "relationship_subject_1", sparse: true },
      ),
      db.collection("objects").createIndex(
        { "relationship.object": 1 },
        { name: "relationship_object_1", sparse: true },
      ),
    ]);
    const objects = getObjectsResource(admin);
    const alpha = await objects({
      action: "create",
      object: {
        name: "Alpha",
        isPerson: true,
        isEvent: true,
        customPayload: "must not be returned by listCards",
        metadata: { internal: "must not be returned by listCards" },
      },
    });
    const beta = await objects({
      action: "create",
      object: {
        name: "Beta",
        details: "endpoint details must not be nested in relationship cards",
        isPerson: true,
      },
    });
    await objects({
      action: "create",
      object: { name: "Gamma", isPerson: true },
    });
    const tag = await objects({
      action: "create",
      object: { name: "Important", isTag: true },
    });
    await objects({
      action: "create",
      object: {
        name: "tagged",
        isRelationship: true,
        relationship: {
          subject: alpha.insertedId,
          object: tag.insertedId,
          symmetrical: false,
        },
      },
    });
    await objects({
      action: "create",
      object: {
        name: "knows",
        isRelationship: true,
        relationship: {
          subject: alpha.insertedId,
          object: beta.insertedId,
          symmetrical: false,
        },
      },
    });

    const first = await objects({
      action: "listCards",
      section: "person",
      sort: "name",
      limit: 2,
    });
    expect(first.items.map((item: any) => item.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(first.items[0].tags.map((item: any) => item.name)).toEqual([
      "Important",
    ]);
    expect(first.items[0]._listCategories).toBeUndefined();
    expect(first.items[0].customPayload).toBeUndefined();
    expect(first.items[0].metadata).toBeUndefined();
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await objects({
      action: "listCards",
      section: "person",
      sort: "name",
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(second.items.map((item: any) => item.name)).toEqual(["Gamma"]);
    expect(second.hasMore).toBe(false);

    const tagged = await objects({
      action: "listCards",
      section: "person",
      filters: { tagIds: [tag.insertedId.toString()], tagMode: "and" },
      limit: 9,
    });
    expect(tagged.items.map((item: any) => item.name)).toEqual(["Alpha"]);

    const tagOptions = await objects({
      action: "listTagOptions",
      ids: [tag.insertedId.toString()],
      limit: 1,
    });
    expect(tagOptions.items.map((item: any) => item.name)).toEqual([
      "Important",
    ]);
    expect(tagOptions.items[0]._listCategories).toBeUndefined();

    const relationships = await objects({
      action: "listCards",
      section: "relationship",
      sort: "name",
      limit: 9,
    });
    const knows = relationships.items.find((item: any) =>
      item.name === "knows"
    );
    expect(knows.subjectObject.name).toBe("Alpha");
    expect(knows.objectObject.name).toBe("Beta");
    expect(knows.subjectObject.customPayload).toBeUndefined();
    expect(knows.objectObject.details).toBeUndefined();

    const split = await objects({
      action: "split",
      sourceId: alpha.insertedId.toString(),
      newObject: { name: "Alpha split" },
      edgeIdsToMove: [],
      aliasesToMove: [],
      version: 1,
    });
    const splitDoc = await objects({
      action: "get",
      id: split.newId.toString(),
    });
    expect(splitDoc._listCategories).toBeUndefined();
    expect(
      (await db.collection("objects").findOne({ _id: split.newId }))
        ?._listCategories,
    ).toEqual(["person", "event"]);
    const merged = await objects({
      action: "merge",
      winnerId: alpha.insertedId.toString(),
      loserIds: [split.newId.toString()],
      version: 2,
    });
    expect(merged.winner._listCategories).toBeUndefined();
    expect(
      (await db.collection("objects").findOne({ _id: alpha.insertedId }))
        ?._listCategories,
    ).toEqual(["person", "event"]);

    const updated = await objects({
      action: "update",
      id: beta.insertedId.toString(),
      version: 1,
      field: "isPerson",
      value: null,
    });
    expect(updated._listCategories).toBeUndefined();
    expect(
      (await db.collection("objects").findOne({ _id: beta.insertedId }))
        ?._listCategories,
    ).toEqual(["other"]);

    await expect(objects({
      action: "create",
      object: {
        name: "Rejected internal field",
        _listCategories: ["person"],
      },
    } as any)).rejects.toThrow("Internal object projection fields");
    await expect(objects({
      action: "create",
      object: {
        name: "Rejected dotted internal field",
        "_listCategories.0": "person",
      },
    } as any)).rejects.toThrow("Internal object projection fields");
    await expect(objects({
      action: "update",
      id: beta.insertedId.toString(),
      version: 2,
      field: "_listCategories",
      value: ["person"],
    } as any)).rejects.toThrow("Internal object projection fields");

    const repair = await objects({
      action: "repairListCatalog",
      batchSize: 1000,
    });
    expect(repair.ready).toBe(true);
    expect(OBJECT_LIST_INDEXES.map((index) => index.name)).toEqual([
      "objects_list_category_updated_v1",
      "objects_list_category_name_v1",
      "objects_list_category_created_v1",
      "objects_starred_updated_v1",
    ]);
  }),
);

Deno.test(
  "object counts expose independent freshness and preserve orphan values",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    await warmMongo(db);
    const objects = getObjectsResource(admin);
    const linked = await objects({
      action: "create",
      object: { name: "Linked", isPerson: true },
    });
    const target = await objects({
      action: "create",
      object: { name: "Target", isPlace: true },
    });
    await objects({ action: "create", object: { name: "Orphan" } });
    await objects({
      action: "create",
      object: {
        name: "visits",
        isRelationship: true,
        relationship: {
          subject: linked.insertedId,
          object: target.insertedId,
          symmetrical: false,
        },
      },
    });

    const [counts, ...joined] = await Promise.all(
      Array.from(
        { length: 10 },
        () => objects({ action: "getCounts", forceRefresh: true }),
      ),
    );
    expect(counts.person).toBe(1);
    expect(counts.place).toBe(1);
    expect(counts.other).toBe(1);
    expect(counts.orphaned).toBe(1);
    expect(counts.meta.typeCounts.status).toBe("fresh");
    expect(counts.meta.orphaned.status).toBe("fresh");
    expect(joined.every((row: any) => row.orphaned === 1)).toBe(true);
  }),
);
