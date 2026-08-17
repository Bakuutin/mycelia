import type { Db, IndexSpecification } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

export const OBJECT_LIST_SCHEMA_VERSION = 1;
export const OBJECT_LIST_STATE_ID = "catalog";

export const OBJECT_LIST_INDEXES: Array<{
  keys: IndexSpecification;
  name: string;
  partialFilterExpression: Record<string, unknown>;
}> = [
  {
    keys: { _listCategories: 1, updatedAt: -1, _id: -1 },
    name: "objects_list_category_updated_v1",
    partialFilterExpression: { _listCategories: { $exists: true } },
  },
  {
    keys: { _listCategories: 1, name: 1, _id: -1 },
    name: "objects_list_category_name_v1",
    partialFilterExpression: { _listCategories: { $exists: true } },
  },
  {
    keys: { _listCategories: 1, createdAt: -1, _id: -1 },
    name: "objects_list_category_created_v1",
    partialFilterExpression: { _listCategories: { $exists: true } },
  },
  {
    keys: { starred: 1, updatedAt: -1, _id: -1 },
    name: "objects_starred_updated_v1",
    partialFilterExpression: { starred: true },
  },
];

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, "object_list_state");
  await db.collection<any>("object_list_state").updateOne(
    { _id: OBJECT_LIST_STATE_ID },
    {
      $setOnInsert: {
        schemaVersion: OBJECT_LIST_SCHEMA_VERSION,
        ready: false,
        lastBackfilledId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );

  for (const index of OBJECT_LIST_INDEXES) {
    await ensureIndexExists(db, "objects", index.keys, {
      name: index.name,
      partialFilterExpression: index.partialFilterExpression,
    });
  }
}

export async function down(db: Db): Promise<void> {
  for (const index of [...OBJECT_LIST_INDEXES].reverse()) {
    if (await db.collection("objects").indexExists(index.name)) {
      await db.collection("objects").dropIndex(index.name);
    }
  }
  await db.collection<any>("object_list_state").deleteOne({
    _id: OBJECT_LIST_STATE_ID,
    schemaVersion: OBJECT_LIST_SCHEMA_VERSION,
  });
}
