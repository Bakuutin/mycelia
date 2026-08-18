import { ObjectId } from "bson";

const TAG_OPTIONS_MAX_TIME_MS = 1_000;

type MongoCall = (input: any) => Promise<any>;

export type ListTagOptionsInput = {
  ids?: string[];
  search?: string;
  limit?: number;
};

const TAG_OPTION_PROJECTION = {
  _id: 1,
  name: 1,
  icon: 1,
  color: 1,
} as const;

export async function listTagOptions(
  mongo: MongoCall,
  input: ListTagOptionsInput,
  catalogReady: boolean,
): Promise<{ items: Record<string, unknown>[] }> {
  const ids = [...new Set(input.ids ?? [])].map((id) => new ObjectId(id));
  const limit = Math.max(1, Math.min(input.limit ?? 32, 50));
  const search = input.search?.trim() ?? "";
  const selected: Record<string, unknown>[] = ids.length === 0
    ? []
    : await mongo({
      action: "find",
      collection: "objects",
      query: { _id: { $in: ids }, isTag: true },
      options: {
        projection: TAG_OPTION_PROJECTION,
        limit: Math.min(ids.length, limit),
        hint: "_id_",
        maxTimeMS: TAG_OPTIONS_MAX_TIME_MS,
      },
    });
  const selectedById = new Map<string, Record<string, unknown>>(
    selected.map((item) => [String(item._id), item]),
  );
  const orderedSelected = ids.map((id) => selectedById.get(String(id))).filter(
    (item): item is Record<string, unknown> => item != null,
  );
  const remaining = Math.max(0, limit - orderedSelected.length);
  if (remaining === 0) return { items: orderedSelected };

  const tagMatch = catalogReady ? { _listCategories: "tag" } : { isTag: true };
  const excluded = ids.length > 0 ? { _id: { $nin: ids } } : {};
  const suggestions = search
    ? await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [
        { $match: { ...tagMatch, ...excluded, $text: { $search: search } } },
        { $set: { score: { $meta: "textScore" } } },
        { $sort: { score: { $meta: "textScore" }, _id: -1 } },
        { $limit: remaining },
        { $project: TAG_OPTION_PROJECTION },
      ],
      options: { maxTimeMS: TAG_OPTIONS_MAX_TIME_MS },
    })
    : await mongo({
      action: "find",
      collection: "objects",
      query: { ...tagMatch, ...excluded },
      options: {
        projection: TAG_OPTION_PROJECTION,
        sort: { name: 1, _id: -1 },
        limit: remaining,
        maxTimeMS: TAG_OPTIONS_MAX_TIME_MS,
        ...(catalogReady ? { hint: "objects_list_category_name_v1" } : {}),
      },
    });

  return { items: [...orderedSelected, ...suggestions] };
}
