import { ObjectId } from "bson";
import {
  deriveEntityTypingPending,
  deriveObjectListCategories,
  OBJECT_LIST_CATEGORIES,
  OBJECT_LIST_TYPE_FLAGS,
} from "./list-categories.ts";

const CATALOG_STATE_ID = "catalog";
const CATALOG_SCHEMA_VERSION = 2;
const CATALOG_MAX_TIME_MS = 8_000;

type MongoCall = (input: any) => Promise<any>;

function sameStrings(left: unknown, right: string[]): boolean {
  return Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function legacyCategoryExpression(category: string): Record<string, any> {
  if (category === "other") {
    return {
      $and: OBJECT_LIST_TYPE_FLAGS.map(([flag]) => ({
        $ne: [`$${flag}`, true],
      })),
    };
  }
  if (category === "relationship") {
    return {
      $and: [
        { $eq: ["$isRelationship", true] },
        { $ne: ["$isPromise", true] },
        { $ne: ["$isTag", true] },
      ],
    };
  }
  const flag = OBJECT_LIST_TYPE_FLAGS.find(([, value]) => value === category)
    ?.[0];
  return { $eq: [`$${flag}`, true] };
}

function expectedCategoriesExpression(): Record<string, any> {
  const categoryParts = OBJECT_LIST_TYPE_FLAGS.map(([flag, category]) => {
    const condition = category === "relationship"
      ? legacyCategoryExpression(category)
      : { $eq: [`$${flag}`, true] };
    return { $cond: [condition, [category], []] };
  });
  categoryParts.push({
    $cond: [legacyCategoryExpression("other"), ["other"], []],
  });
  return { $concatArrays: categoryParts };
}

export function buildCatalogValidationPipeline(): Record<string, any>[] {
  return [
    {
      $project: {
        expectedCategories: expectedCategoriesExpression(),
        catalogCategories: {
          $cond: [
            { $isArray: "$_listCategories" },
            "$_listCategories",
            [],
          ],
        },
        categoriesMissing: {
          $eq: [{ $type: "$_listCategories" }, "missing"],
        },
      },
    },
    {
      $group: {
        _id: null,
        missing: { $sum: { $cond: ["$categoriesMissing", 1, 0] } },
        mismatched: {
          $sum: {
            $cond: [
              { $ne: ["$catalogCategories", "$expectedCategories"] },
              1,
              0,
            ],
          },
        },
        ...Object.fromEntries(OBJECT_LIST_CATEGORIES.flatMap((category) => [
          [
            `legacy_${category}`,
            {
              $sum: {
                $cond: [
                  { $in: [category, "$expectedCategories"] },
                  1,
                  0,
                ],
              },
            },
          ],
          [
            `catalog_${category}`,
            {
              $sum: {
                $cond: [
                  { $in: [category, "$catalogCategories"] },
                  1,
                  0,
                ],
              },
            },
          ],
        ])),
      },
    },
  ];
}

async function validateCatalog(mongo: MongoCall) {
  const rows = await mongo({
    action: "aggregate",
    collection: "objects",
    pipeline: buildCatalogValidationPipeline(),
    options: { maxTimeMS: CATALOG_MAX_TIME_MS },
  });
  const parityRow = rows[0] ?? {};
  const parity = Object.fromEntries(
    OBJECT_LIST_CATEGORIES.map((category) => [
      category,
      {
        legacy: parityRow[`legacy_${category}`] ?? 0,
        catalog: parityRow[`catalog_${category}`] ?? 0,
        matches: (parityRow[`legacy_${category}`] ?? 0) ===
          (parityRow[`catalog_${category}`] ?? 0),
      },
    ]),
  );
  const missing = parityRow.missing ?? 0;
  const mismatched = parityRow.mismatched ?? 0;
  return {
    missing,
    mismatched,
    parity,
    valid: missing === 0 && mismatched === 0 &&
      Object.values(parity).every((entry: any) => entry.matches),
  };
}

export async function isObjectListCatalogReady(
  mongo: MongoCall,
): Promise<boolean> {
  const state = await mongo({
    action: "findOne",
    collection: "object_list_state",
    query: { _id: CATALOG_STATE_ID },
  });
  return state?.schemaVersion === CATALOG_SCHEMA_VERSION &&
    state.ready === true;
}

export async function repairObjectListCatalog(
  mongo: MongoCall,
  batchSize: number,
) {
  const state = await mongo({
    action: "findOne",
    collection: "object_list_state",
    query: { _id: CATALOG_STATE_ID },
  });
  const lastBackfilledId = state?.lastBackfilledId
    ? new ObjectId(state.lastBackfilledId)
    : null;
  const rows = await mongo({
    action: "find",
    collection: "objects",
    query: lastBackfilledId ? { _id: { $gt: lastBackfilledId } } : {},
    options: {
      projection: {
        _listCategories: 1,
        _entityTypingPending: 1,
        name: 1,
        metadata: 1,
        ...Object.fromEntries(
          OBJECT_LIST_TYPE_FLAGS.map(([flag]) => [flag, 1]),
        ),
      },
      sort: { _id: 1 },
      limit: batchSize,
      hint: "_id_",
      maxTimeMS: CATALOG_MAX_TIME_MS,
    },
  });
  const operations = rows.flatMap((row: Record<string, any>) => {
    const expected = deriveObjectListCategories(row);
    const entityTypingPending = deriveEntityTypingPending(row);
    return sameStrings(row._listCategories, expected) &&
        row._entityTypingPending === entityTypingPending
      ? []
      : [{
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            _listCategories: expected,
            _entityTypingPending: entityTypingPending,
          },
        },
      },
    }];
  });
  if (operations.length > 0) {
    await mongo({
      action: "bulkWrite",
      collection: "objects",
      operations,
      options: { ordered: false, touchUpdatedAt: false },
    });
  }

  const lastId = rows.at(-1)?._id ?? lastBackfilledId;
  if (rows.length === batchSize) {
    await mongo({
      action: "updateOne",
      collection: "object_list_state",
      query: { _id: CATALOG_STATE_ID },
      update: {
        $set: {
          schemaVersion: CATALOG_SCHEMA_VERSION,
          ready: false,
          entityTypingReady: false,
          lastBackfilledId: lastId,
          backfilledAt: new Date(),
        },
      },
      options: { upsert: true, touchUpdatedAt: false },
    });
    return {
      processed: rows.length,
      modified: operations.length,
      complete: false,
      ready: false,
      lastBackfilledId: lastId,
    };
  }

  const validation = await validateCatalog(mongo);
  await mongo({
    action: "updateOne",
    collection: "object_list_state",
    query: { _id: CATALOG_STATE_ID },
    update: {
      $set: {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        ready: validation.valid,
        entityTypingReady: validation.valid,
        lastBackfilledId: validation.valid ? lastId : null,
        validatedAt: new Date(),
        validation,
      },
    },
    options: { upsert: true, touchUpdatedAt: false },
  });
  return {
    processed: rows.length,
    modified: operations.length,
    complete: true,
    ready: validation.valid,
    lastBackfilledId: validation.valid ? lastId : null,
    validation,
  };
}
