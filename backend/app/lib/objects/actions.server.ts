import { ObjectId } from "bson";
import { Db } from "mongodb";
import { ObjectsRequest, getNestedValue } from "./schemas.ts";
import { invalidateCountsCache, getCachedCounts, refreshCounts, refreshTypeCountsOnly } from "./cache.server.ts";
import { recordHistory } from "./history.server.ts";

type MongoResource = (input: any) => Promise<any>;

export async function handleCreate(
  input: Extract<ObjectsRequest, { action: "create" }>,
  mongo: MongoResource,
  db: Db,
  userId: string,
) {
  const doc = {
    ...input.object,
    version: 1,
    createdAt: new Date(),
  };

  const result = await mongo({
    action: "insertOne",
    collection: "objects",
    doc,
  });

  await recordHistory(
    db,
    result.insertedId,
    "create",
    userId,
    1,
    null,
    undefined,
    doc,
  );

  await invalidateCountsCache(db);

  return { insertedId: result.insertedId };
}

export async function handleGet(
  input: Extract<ObjectsRequest, { action: "get" }>,
  mongo: MongoResource,
) {
  const objectId = new ObjectId(input.id as string);
  const object = await mongo({
    action: "findOne",
    collection: "objects",
    query: { _id: objectId },
  });
  if (!object) {
    throw new Error("Object not found");
  }
  if (object.version === undefined) {
    object.version = 0;
  }
  return object;
}

export async function handleUpdate(
  input: Extract<ObjectsRequest, { action: "update" }>,
  mongo: MongoResource,
  db: Db,
  userId: string,
) {
  const objectId = new ObjectId(input.id as string);

  const current = await mongo({
    action: "findOne",
    collection: "objects",
    query: { _id: objectId },
  });
  if (!current) {
    throw new Error("Object not found");
  }

  const currentVersion = current.version ?? 0;

  if (currentVersion !== input.version) {
    const error: any = new Error("Object was modified by another user");
    error.code = 409;
    error.current = currentVersion;
    error.expected = input.version;
    error.latestObject = { ...current, version: currentVersion };
    throw error;
  }

  const oldValue = getNestedValue(current, input.field);

  const updateDoc: any = {};

  if (input.value === null || input.value === undefined) {
    updateDoc.$unset = { [input.field]: "" };
    updateDoc.$set = {
      version: currentVersion + 1,
    };
  } else {
    updateDoc.$set = {
      [input.field]: input.value,
      version: currentVersion + 1,
    };
  }

  await mongo({
    action: "updateOne",
    collection: "objects",
    query: { _id: objectId },
    update: updateDoc,
  });

  const result = await mongo({
    action: "findOne",
    collection: "objects",
    query: { _id: objectId },
  });

  if (!result) {
    const error: any = new Error("Update failed");
    error.code = 500;
    throw error;
  }

  await recordHistory(
    db,
    objectId,
    "update",
    userId,
    result.version,
    input.field,
    oldValue,
    input.value,
  );

  const typeFields = ["isPerson", "isEvent", "isRelationship", "isPromise", "isConversation"];
  if (typeFields.includes(input.field) || input.field.startsWith("relationship")) {
    await invalidateCountsCache(db);
  }

  return result;
}

export async function handleDelete(
  input: Extract<ObjectsRequest, { action: "delete" }>,
  mongo: MongoResource,
  db: Db,
  userId: string,
) {
  const objectId = new ObjectId(input.id as string);

  const current = await mongo({
    action: "findOne",
    collection: "objects",
    query: { _id: objectId },
  });
  if (!current) {
    throw new Error("Object not found");
  }

  const result = await mongo({
    action: "deleteOne",
    collection: "objects",
    query: { _id: objectId },
  });

  await recordHistory(
    db,
    objectId,
    "delete",
    userId,
    current.version ?? 0,
    null,
    current,
    undefined,
  );

  await invalidateCountsCache(db);

  return { deletedCount: result.deletedCount };
}

export async function handleList(
  input: Extract<ObjectsRequest, { action: "list" }>,
  mongo: MongoResource,
) {
  let query = input.filters || {};

  if (input.options?.hasTimeRanges) {
    query = {
      ...query,
      timeRanges: { $exists: true, $ne: [] },
    };
  }

  if (input.options?.searchTerm && input.options.searchTerm.trim()) {
    const searchRegex = {
      $regex: input.options.searchTerm,
      $options: "i",
    };
    query = {
      ...query,
      $or: [
        { name: searchRegex },
        { aliases: searchRegex },
      ],
    };
  }

  if (input.options?.timeRangeFilter) {
    const filterStart = new Date(input.options.timeRangeFilter.start);
    const filterEnd = new Date(input.options.timeRangeFilter.end);

    query = {
      ...query,
      timeRanges: {
        $elemMatch: {
          start: { $lt: filterEnd },
          $or: [
            { end: { $gt: filterStart } },
            { end: { $exists: false } },
          ],
        },
      },
    };
  }

  if (input.options?.includeRelationships) {
    const pipeline: any[] = [
      {
        $addFields: {
          hasTimeRanges: {
            $cond: {
              if: { $isArray: "$timeRanges" },
              then: true,
              else: false,
            },
          },
        },
      },
      { $match: query },
      {
        $lookup: {
          from: "objects",
          localField: "relationship.subject",
          foreignField: "_id",
          as: "subjectObject",
        },
      },
      {
        $lookup: {
          from: "objects",
          localField: "relationship.object",
          foreignField: "_id",
          as: "objectObject",
        },
      },
      {
        $unwind: {
          path: "$subjectObject",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$objectObject",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          earliestStart: {
            $min: {
              $map: {
                input: "$timeRanges",
                as: "r",
                in: "$$r.start",
              },
            },
          },
          latestEnd: {
            $max: {
              $map: {
                input: "$timeRanges",
                as: "r",
                in: { $ifNull: ["$$r.end", "$$r.start"] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          duration: { $subtract: ["$latestEnd", "$earliestStart"] },
        },
      },
    ];

    if (input.options?.sort) {
      pipeline.push({ $sort: input.options.sort });
    }

    if (input.options?.skip) {
      pipeline.push({ $skip: input.options.skip });
    }

    if (input.options?.limit) {
      pipeline.push({ $limit: input.options.limit });
    }

    return await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline,
    });
  }

  const findOptions: any = {};
  if (input.options?.sort) {
    findOptions.sort = input.options.sort;
  }
  if (input.options?.skip) {
    findOptions.skip = input.options.skip;
  }
  if (input.options?.limit) {
    findOptions.limit = input.options.limit;
  }

  return await mongo({
    action: "find",
    collection: "objects",
    query,
    options: findOptions,
  });
}

export async function handleGetRelationships(
  input: Extract<ObjectsRequest, { action: "getRelationships" }>,
  mongo: MongoResource,
) {
  const objectId = new ObjectId(input.id as string);

  const pipeline = [
    { $match: { isRelationship: true } },
    {
      $match: {
        $or: [
          { "relationship.subject": objectId },
          { "relationship.object": objectId },
        ],
      },
    },
    {
      $lookup: {
        from: "objects",
        localField: "relationship.subject",
        foreignField: "_id",
        as: "subjectObj",
      },
    },
    {
      $lookup: {
        from: "objects",
        localField: "relationship.object",
        foreignField: "_id",
        as: "objectObj",
      },
    },
    {
      $unwind: { path: "$subjectObj", preserveNullAndEmptyArrays: true },
    },
    { $unwind: { path: "$objectObj", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        relationship: "$$ROOT",
        other: {
          $cond: [
            { $eq: ["$relationship.subject", objectId] },
            "$objectObj",
            "$subjectObj",
          ],
        },
      },
    },
    {
      $set: {
        earliestStart: {
          $min: {
            $map: {
              input: "$relationship.timeRanges",
              as: "r",
              in: "$$r.start",
            },
          },
        },
        latestEnd: {
          $max: {
            $map: {
              input: "$relationship.timeRanges",
              as: "r",
              in: "$$r.end",
            },
          },
        },
      },
    },
    {
      $set: {
        endOrNow: { $ifNull: ["$latestEnd", new Date()] },
      },
    },
    {
      $set: {
        duration: { $subtract: ["$endOrNow", "$earliestStart"] },
      },
    },
    { $sort: { endOrNow: -1, earliestStart: -1 } },
  ];

  return await mongo({
    action: "aggregate",
    collection: "objects",
    pipeline,
  });
}

export async function handleGetHistory(
  input: Extract<ObjectsRequest, { action: "getHistory" }>,
  mongo: MongoResource,
) {
  const objectId = new ObjectId(input.id as string);

  const findOptions: any = {
    sort: { timestamp: -1 },
  };
  if (input.skip != null) {
    findOptions.skip = input.skip;
  }
  findOptions.limit = input.limit ?? 50;

  try {
    return await mongo({
      action: "find",
      collection: "object_history",
      query: { objectId: objectId },
      options: findOptions,
    });
  } catch (error) {
    console.error("Error fetching object history:", error);
    throw new Error(
      `Failed to fetch object history: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function handleExploreTimeRange(
  input: Extract<ObjectsRequest, { action: "exploreTimeRange" }>,
  mongo: MongoResource,
) {
  console.log("[exploreTimeRange] Input:", JSON.stringify({
    start: input.start,
    end: input.end,
    filters: input.filters,
    options: input.options,
    startType: typeof input.start,
    endType: typeof input.end,
  }, null, 2));

  const timeRangeQuery = {
    timeRanges: {
      $elemMatch: {
        start: { $lte: input.end },
        $or: [
          { end: { $gte: input.start } },
          { end: null },
        ],
      },
    },
  };

  const query = input.filters
    ? { ...input.filters, ...timeRangeQuery }
    : timeRangeQuery;

  console.log("[exploreTimeRange] Constructed query:", JSON.stringify(query, null, 2));

  if (input.options?.includeRelationships) {
    const pipeline: any[] = [
      { $match: query },
      {
        $lookup: {
          from: "objects",
          localField: "relationship.subject",
          foreignField: "_id",
          as: "subjectObject",
        },
      },
      {
        $lookup: {
          from: "objects",
          localField: "relationship.object",
          foreignField: "_id",
          as: "objectObject",
        },
      },
      {
        $unwind: {
          path: "$subjectObject",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$objectObject",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    pipeline.push({
      $addFields: {
        _minTimeRangeStart: { $min: "$timeRanges.start" },
      },
    });

    pipeline.push({ $sort: input.options?.sort || { _minTimeRangeStart: 1 } });

    if (input.options?.skip) {
      pipeline.push({ $skip: input.options.skip });
    }

    if (input.options?.limit) {
      pipeline.push({ $limit: input.options.limit });
    }

    pipeline.push({ $project: {
      _id: 1,
      name: 1,
      icon: 1,
      timeRanges: 1,
      summaries: { $map: { input: "$summaries", as: "s", in: "$$s.text" } },
      isEvent: 1,
      isPerson: 1,
      isRelationship: 1,
      isConversation: 1,
      isPromise: 1,
      subjectObject: { _id: 1, name: 1, icon: 1 },
      objectObject: { _id: 1, name: 1, icon: 1 },
    }});

    const countResult = await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [{ $match: query }, { $count: "total" }],
    });
    const total = countResult?.[0]?.total || 0;

    const objects = await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline,
    });

    console.log("[exploreTimeRange] Aggregate result - total:", total, "returned:", objects?.length);
    return { total, objects };
  }

  const pipeline: any[] = [
    { $match: query },
    { $addFields: { _minTimeRangeStart: { $min: "$timeRanges.start" } } },
    { $sort: input.options?.sort || { _minTimeRangeStart: 1 } },
  ];

  if (input.options?.skip) {
    pipeline.push({ $skip: input.options.skip });
  }
  if (input.options?.limit) {
    pipeline.push({ $limit: input.options.limit });
  }

  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      icon: 1,
      timeRanges: 1,
      summaries: { $map: { input: "$summaries", as: "s", in: "$$s.text" } },
      isEvent: 1,
      isPerson: 1,
      isRelationship: 1,
      isConversation: 1,
      isPromise: 1,
    },
  });

  console.log("[exploreTimeRange] Pipeline:", JSON.stringify(pipeline, null, 2));

  const countResult = await mongo({
    action: "aggregate",
    collection: "objects",
    pipeline: [{ $match: query }, { $count: "total" }],
  });
  const total = countResult?.[0]?.total || 0;

  const objects = await mongo({
    action: "aggregate",
    collection: "objects",
    pipeline,
  });

  console.log("[exploreTimeRange] Result - total:", total, "returned:", objects?.length);

  return { total, objects };
}

export async function handleGetTimeRange(mongo: MongoResource) {
  const pipeline = [
    {
      $match: {
        timeRanges: { $exists: true, $ne: [] },
      },
    },
    {
      $unwind: "$timeRanges",
    },
    {
      $group: {
        _id: null,
        minStart: { $min: "$timeRanges.start" },
        maxEnd: {
          $max: {
            $ifNull: ["$timeRanges.end", "$timeRanges.start"],
          },
        },
      },
    },
  ];

  const result = await mongo({
    action: "aggregate",
    collection: "objects",
    pipeline,
  });

  if (result && result.length > 0) {
    return {
      start: result[0].minStart,
      end: result[0].maxEnd,
    };
  }

  return { start: null, end: null };
}

export async function handleGetCounts(
  input: Extract<ObjectsRequest, { action: "getCounts" }>,
  db: Db,
) {
  if (input.forceRefresh) {
    return await refreshCounts(db);
  }

  const cached = await getCachedCounts(db);
  if (cached) {
    if (cached.stale) {
      refreshCounts(db).catch(err => 
        console.error("Background counts refresh failed:", err)
      );
    }
    return cached;
  }

  return await refreshTypeCountsOnly(db);
}
