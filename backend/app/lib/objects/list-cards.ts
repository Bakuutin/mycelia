import { ObjectId } from "bson";
import type { ObjectListCategory } from "./list-categories.ts";
import { legacyObjectListMatch } from "./list-categories.ts";

export const OBJECT_LIST_MAX_TIME_MS = 3_000;
const MAX_CURSOR_OFFSET = 100_000;

export type ObjectCardsSection = ObjectListCategory | "starred";
export type ObjectCardsSort = "updatedAt" | "createdAt" | "name";

export interface ListObjectCardsInput {
  section: ObjectCardsSection;
  filters?: {
    search?: string;
    tagIds?: string[];
    tagMode?: "and" | "or";
    orphanedOnly?: boolean;
  };
  sort?: ObjectCardsSort;
  cursor?: string;
  limit?: number;
}

type MongoCall = (input: any) => Promise<any>;

interface ListCursor {
  v: 1;
  queryKey: string;
  mode: "keyset" | "offset";
  sort: ObjectCardsSort;
  value?: string | null;
  id?: string;
  offset?: number;
}

const SORTS: Record<
  ObjectCardsSort,
  { direction: 1 | -1; index: string }
> = {
  updatedAt: { direction: -1, index: "objects_list_category_updated_v1" },
  createdAt: { direction: -1, index: "objects_list_category_created_v1" },
  name: { direction: 1, index: "objects_list_category_name_v1" },
};

export const OBJECT_CARD_PROJECTION = {
  _id: 1,
  name: 1,
  details: 1,
  icon: 1,
  color: 1,
  aliases: 1,
  isEvent: 1,
  isPerson: 1,
  isRelationship: 1,
  isPromise: 1,
  isConversation: 1,
  isTag: 1,
  isPlace: 1,
  isOrganization: 1,
  isProduct: 1,
  isProject: 1,
  isAnimal: 1,
  isConcept: 1,
  isMedia: 1,
  starred: 1,
  relationship: 1,
  timeRanges: 1,
  createdAt: 1,
  updatedAt: 1,
  version: 1,
} as const;

const RELATIONSHIP_ENDPOINT_PROJECTION = {
  _id: 1,
  name: 1,
  icon: 1,
  color: 1,
} as const;

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function decodeBase64Url(value: string): string {
  if (value.length > 2_048) throw new Error("Invalid object list cursor");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function queryKey(input: ListObjectCardsInput, sort: ObjectCardsSort): string {
  const tagIds = [...(input.filters?.tagIds ?? [])].sort();
  return JSON.stringify({
    section: input.section,
    search: input.filters?.search?.trim() ?? "",
    tagIds,
    tagMode: input.filters?.tagMode ?? "and",
    orphanedOnly: input.filters?.orphanedOnly === true,
    sort: input.section === "starred" ? "updatedAt" : sort,
  });
}

function decodeCursor(
  encoded: string | undefined,
  expectedQueryKey: string,
): ListCursor | null {
  if (!encoded) return null;
  try {
    const cursor = JSON.parse(decodeBase64Url(encoded)) as ListCursor;
    if (
      cursor.v !== 1 || cursor.queryKey !== expectedQueryKey ||
      !["keyset", "offset"].includes(cursor.mode) || !(cursor.sort in SORTS)
    ) {
      throw new Error("Invalid object list cursor");
    }
    if (
      cursor.mode === "offset" &&
      (!Number.isInteger(cursor.offset) || cursor.offset! < 0 ||
        cursor.offset! > MAX_CURSOR_OFFSET)
    ) {
      throw new Error("Invalid object list cursor");
    }
    if (
      cursor.mode === "keyset" &&
      (typeof cursor.id !== "string" || !ObjectId.isValid(cursor.id))
    ) {
      throw new Error("Invalid object list cursor");
    }
    return cursor;
  } catch (error) {
    const badCursor: any = new Error("Invalid object list cursor");
    badCursor.code = 400;
    badCursor.cause = error;
    throw badCursor;
  }
}

function encodeCursor(cursor: ListCursor): string {
  return encodeBase64Url(JSON.stringify(cursor));
}

function andMatch(
  ...parts: Array<Record<string, any> | null | undefined>
): Record<string, any> {
  const present = parts.filter((part): part is Record<string, any> =>
    Boolean(part && Object.keys(part).length)
  );
  if (present.length === 0) return {};
  if (present.length === 1) return present[0];
  return { $and: present };
}

function categoryMatch(
  section: Exclude<ObjectCardsSection, "starred">,
  catalogReady: boolean,
): Record<string, any> {
  return catalogReady
    ? { _listCategories: section }
    : legacyObjectListMatch(section);
}

function cursorMatch(
  cursor: ListCursor | null,
  sort: ObjectCardsSort,
): Record<string, any> | null {
  if (!cursor || cursor.mode !== "keyset") return null;
  const direction = SORTS[sort].direction;
  const comparison = direction === -1 ? "$lt" : "$gt";
  const rawValue = cursor.value ?? null;
  const value = sort === "name" || rawValue === null
    ? rawValue
    : new Date(rawValue);
  return {
    $or: [
      { [sort]: { [comparison]: value } },
      { [sort]: value, _id: { $lt: new ObjectId(cursor.id!) } },
    ],
  };
}

function cursorValue(doc: Record<string, any>, sort: ObjectCardsSort) {
  const value = doc[sort];
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function stripInternalFields(doc: Record<string, any>): Record<string, any> {
  const { _listCategories: _ignored, ...visible } = doc;
  return visible;
}

async function fetchCandidates(
  mongo: MongoCall,
  input: ListObjectCardsInput,
  catalogReady: boolean,
  sort: ObjectCardsSort,
  cursor: ListCursor | null,
  candidateLimit: number,
): Promise<Record<string, any>[]> {
  const section = input.section;
  const filters = input.filters ?? {};
  const search = filters.search?.trim() ?? "";
  const sortSpec = { [sort]: SORTS[sort].direction, _id: -1 };
  const baseMatch = section === "starred"
    ? { starred: true }
    : categoryMatch(section, catalogReady);

  if (section === "starred") {
    return await mongo({
      action: "find",
      collection: "objects",
      query: andMatch(baseMatch, cursorMatch(cursor, "updatedAt")),
      options: {
        projection: OBJECT_CARD_PROJECTION,
        sort: { updatedAt: -1, _id: -1 },
        limit: candidateLimit,
        maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
        hint: "objects_starred_updated_v1",
      },
    });
  }

  if (search) {
    const offset = cursor?.mode === "offset" ? cursor.offset ?? 0 : 0;
    return await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [
        { $match: andMatch(baseMatch, { $text: { $search: search } }) },
        { $set: { score: { $meta: "textScore" } } },
        { $sort: { score: { $meta: "textScore" }, _id: -1 } },
        ...(offset ? [{ $skip: offset }] : []),
        { $limit: candidateLimit },
        { $project: OBJECT_CARD_PROJECTION },
      ],
      options: { maxTimeMS: OBJECT_LIST_MAX_TIME_MS },
    });
  }

  return await mongo({
    action: "find",
    collection: "objects",
    query: andMatch(baseMatch, cursorMatch(cursor, sort)),
    options: {
      projection: OBJECT_CARD_PROJECTION,
      sort: sortSpec,
      limit: candidateLimit,
      maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
      ...(catalogReady ? { hint: SORTS[sort].index } : {}),
    },
  });
}

async function filterTaggedCandidates(
  mongo: MongoCall,
  candidates: Record<string, any>[],
  tagIds: string[],
  tagMode: "and" | "or",
  limit: number,
): Promise<{ items: Record<string, any>[]; consumed: number }> {
  if (candidates.length === 0) return { items: [], consumed: 0 };
  const objectIds = candidates.map((item) => item._id);
  const tagObjectIds = tagIds.map((id) => new ObjectId(id));
  const pipeline: Record<string, any>[] = [
    {
      $match: {
        isRelationship: true,
        name: "tagged",
        "relationship.subject": { $in: objectIds },
        "relationship.object": { $in: tagObjectIds },
      },
    },
    {
      $group: {
        _id: "$relationship.subject",
        matchedTags: { $addToSet: "$relationship.object" },
      },
    },
  ];
  if (tagMode === "and" && tagObjectIds.length > 1) {
    pipeline.push(
      { $set: { matchedTagCount: { $size: "$matchedTags" } } },
      { $match: { matchedTagCount: tagObjectIds.length } },
    );
  }
  pipeline.push({ $project: { _id: 1 } });
  const rows = await mongo({
    action: "aggregate",
    collection: "objects",
    pipeline,
    options: {
      maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
      hint: "relationship_subject_1",
    },
  });
  const matchingIds = new Set(rows.map((row: any) => String(row._id)));
  const items: Record<string, any>[] = [];
  let consumed = 0;
  for (const candidate of candidates) {
    consumed += 1;
    if (matchingIds.has(String(candidate._id))) items.push(candidate);
    if (items.length === limit) break;
  }
  return { items, consumed };
}

async function filterOrphanedCandidates(
  mongo: MongoCall,
  candidates: Record<string, any>[],
  limit: number,
): Promise<{ items: Record<string, any>[]; consumed: number }> {
  if (candidates.length === 0) return { items: [], consumed: 0 };
  const ids = candidates.map((item) => item._id);
  const [subjectRows, objectRows] = await Promise.all([
    mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [
        {
          $match: {
            isRelationship: true,
            "relationship.subject": { $in: ids },
          },
        },
        { $group: { _id: "$relationship.subject" } },
      ],
      options: {
        maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
        hint: "relationship_subject_1",
      },
    }),
    mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [
        {
          $match: {
            isRelationship: true,
            "relationship.object": { $in: ids },
          },
        },
        { $group: { _id: "$relationship.object" } },
      ],
      options: {
        maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
        hint: "relationship_object_1",
      },
    }),
  ]);
  const referenced = new Set<string>([
    ...subjectRows.map((row: any) => String(row._id)),
    ...objectRows.map((row: any) => String(row._id)),
  ]);
  const items: Record<string, any>[] = [];
  let consumed = 0;
  for (const candidate of candidates) {
    consumed += 1;
    if (!referenced.has(String(candidate._id))) items.push(candidate);
    if (items.length === limit) break;
  }
  return { items, consumed };
}

async function hydrateCards(
  mongo: MongoCall,
  section: ObjectCardsSection,
  items: Record<string, any>[],
): Promise<Record<string, any>[]> {
  if (items.length === 0) return [];
  const hydrated = items.map((item) => ({ ...item }));
  const byId = new Map(hydrated.map((item) => [String(item._id), item]));

  const relationshipCards = section === "relationship"
    ? hydrated
    : section === "starred"
    ? hydrated.filter((item) => item.isRelationship === true)
    : [];
  const endpointIds = relationshipCards.flatMap((item) => [
    item.relationship?.subject,
    item.relationship?.object,
  ]).filter(Boolean);
  if (endpointIds.length > 0) {
    const endpointDocs = await mongo({
      action: "find",
      collection: "objects",
      query: { _id: { $in: endpointIds } },
      options: {
        projection: RELATIONSHIP_ENDPOINT_PROJECTION,
        limit: endpointIds.length,
        maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
      },
    });
    const endpoints = new Map(
      endpointDocs.map((doc: any) => [String(doc._id), doc]),
    );
    for (const item of relationshipCards) {
      item.subjectObject = endpoints.get(String(item.relationship?.subject));
      item.objectObject = endpoints.get(String(item.relationship?.object));
    }
  }

  const shouldHydrateTags = section === "starred" ||
    (section !== "relationship" && section !== "tag");
  if (shouldHydrateTags) {
    const ids = hydrated.map((item) => item._id);
    const tagEdges = await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [
        {
          $match: {
            isRelationship: true,
            name: "tagged",
            "relationship.subject": { $in: ids },
          },
        },
        {
          $group: {
            _id: "$relationship.subject",
            tagIds: { $push: "$relationship.object" },
          },
        },
        { $project: { tagIds: { $slice: ["$tagIds", 5] } } },
      ],
      options: {
        maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
        hint: "relationship_subject_1",
      },
    });
    const allTagIds = tagEdges.flatMap((row: any) => row.tagIds ?? []);
    const tagDocs = allTagIds.length > 0
      ? await mongo({
        action: "find",
        collection: "objects",
        query: { _id: { $in: allTagIds } },
        options: {
          projection: { name: 1, icon: 1, color: 1 },
          limit: allTagIds.length,
          maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
        },
      })
      : [];
    const tagsById = new Map(tagDocs.map((doc: any) => [String(doc._id), doc]));
    for (const row of tagEdges) {
      const item = byId.get(String(row._id));
      if (item) {
        item.tags = (row.tagIds ?? []).map((id: any) =>
          tagsById.get(String(id))
        ).filter(Boolean);
      }
    }
    for (const item of hydrated) item.tags ??= [];
  }

  if (section === "tag") {
    const counts = await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [
        {
          $match: {
            isRelationship: true,
            name: "tagged",
            "relationship.object": { $in: hydrated.map((item) => item._id) },
          },
        },
        { $group: { _id: "$relationship.object", count: { $sum: 1 } } },
      ],
      options: {
        maxTimeMS: OBJECT_LIST_MAX_TIME_MS,
        hint: "relationship_object_1",
      },
    });
    const countsById = new Map(
      counts.map((row: any) => [String(row._id), row.count]),
    );
    for (const item of hydrated) {
      item.linkedObjectsCount = countsById.get(String(item._id)) ?? 0;
    }
  }

  return hydrated.map(stripInternalFields);
}

export async function listObjectCards(
  mongo: MongoCall,
  input: ListObjectCardsInput,
  catalogReady: boolean,
): Promise<{
  items: Record<string, any>[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const filters = input.section === "starred" ? {} : {
    ...input.filters,
    ...(input.filters?.tagIds
      ? { tagIds: [...new Set(input.filters.tagIds)] }
      : {}),
  };
  const normalizedInput = { ...input, filters };
  const requestedLimit = Math.max(1, Math.min(input.limit ?? 9, 50));
  const limit = input.section === "starred"
    ? Math.min(requestedLimit, 50)
    : requestedLimit;
  const sort: ObjectCardsSort = input.section === "starred"
    ? "updatedAt"
    : input.sort ?? "updatedAt";
  const key = queryKey(normalizedInput, sort);
  const cursor = decodeCursor(input.cursor, key);
  const usesOffset = Boolean(filters.search?.trim());
  if (cursor && cursor.mode !== (usesOffset ? "offset" : "keyset")) {
    const error: any = new Error("Invalid object list cursor");
    error.code = 400;
    throw error;
  }

  if (
    input.section === "relationship" && filters.orphanedOnly === true
  ) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  if (filters.orphanedOnly === true && (filters.tagIds?.length ?? 0) > 0) {
    // A tagged object is necessarily referenced by its `tagged` relationship,
    // so it cannot satisfy the existing orphan definition.
    return { items: [], nextCursor: null, hasMore: false };
  }

  const needsMembershipFilter = filters.orphanedOnly === true ||
    (filters.tagIds?.length ?? 0) > 0;
  const scanLimit = needsMembershipFilter ? limit * 5 : limit;
  const fetched = await fetchCandidates(
    mongo,
    normalizedInput,
    catalogReady,
    sort,
    cursor,
    scanLimit + 1,
  );
  const overflow = fetched.length > scanLimit;
  const candidates = overflow ? fetched.slice(0, scanLimit) : fetched;
  const filtered = (filters.tagIds?.length ?? 0) > 0
    ? await filterTaggedCandidates(
      mongo,
      candidates,
      filters.tagIds!,
      filters.tagMode ?? "and",
      limit,
    )
    : filters.orphanedOnly
    ? await filterOrphanedCandidates(mongo, candidates, limit)
    : {
      items: candidates.slice(0, limit),
      consumed: Math.min(limit, candidates.length),
    };
  const hasMore = overflow || filtered.consumed < candidates.length;
  const hydrated = await hydrateCards(mongo, input.section, filtered.items);

  let nextCursor: string | null = null;
  if (hasMore && filtered.consumed > 0) {
    if (usesOffset) {
      nextCursor = encodeCursor({
        v: 1,
        queryKey: key,
        mode: "offset",
        sort,
        offset: (cursor?.offset ?? 0) + filtered.consumed,
      });
    } else {
      const last = candidates[filtered.consumed - 1];
      nextCursor = encodeCursor({
        v: 1,
        queryKey: key,
        mode: "keyset",
        sort,
        value: cursorValue(last, sort),
        id: String(last._id),
      });
    }
  }

  return { items: hydrated, nextCursor, hasMore };
}
