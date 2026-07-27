export type SummaryHistoryFilters = {
  model?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type SummaryHistoryEntry = {
  id: string;
  objectId: string;
  objectName: string;
  generatedAt: string | Date;
  coverageStart?: string | Date;
  coverageEnd?: string | Date;
  requestedModel: string;
  executedModel: string;
  fallbackModel?: string;
  fallbackUsed: boolean;
  promptName?: string;
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cost?: number;
  };
  jobId?: string;
  jobState?: string;
  jobFinishedAt?: string | Date;
};

export type SummaryHistoryModel = {
  model: string;
  count: number;
  latestAt?: string | Date;
};

export type SummaryHistoryResult = {
  entries: SummaryHistoryEntry[];
  models: SummaryHistoryModel[];
  total: number;
};

export type SummaryTaskStatus =
  | "all"
  | "completed"
  | "unfinished"
  | "failed"
  | "cancelled";

export type SummaryTaskFilters = {
  status?: SummaryTaskStatus;
  model?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type SummaryTaskEntry = {
  id: string;
  state: string;
  createdAt: string | Date;
  startedAt?: string | Date;
  finishedAt?: string | Date;
  failedReason?: string;
  requestedModel: string;
  fallbackModel?: string;
  trigger?: {
    type?: string;
    reason?: string;
  };
  progress?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

export type SummaryTaskCounts = {
  total: number;
  completed: number;
  unfinished: number;
  failed: number;
  cancelled: number;
};

export type SummaryTaskResult = {
  entries: SummaryTaskEntry[];
  counts: SummaryTaskCounts;
  models: SummaryHistoryModel[];
};

function endOfLocalDay(value: string): Date {
  const date = new Date(`${value}T23:59:59.999`);
  return date;
}

function startOfLocalDay(value: string): Date {
  return new Date(`${value}T00:00:00.000`);
}

export function buildSummaryHistoryPipeline(
  filters: SummaryHistoryFilters,
): Record<string, unknown>[] {
  const summaryMatch: Record<string, unknown> = {};
  const generatedAt: Record<string, Date> = {};

  if (filters.from) generatedAt.$gte = startOfLocalDay(filters.from);
  if (filters.to) generatedAt.$lte = endOfLocalDay(filters.to);
  if (Object.keys(generatedAt).length > 0) {
    summaryMatch["summaries.date"] = generatedAt;
  }

  if (filters.model && filters.model !== "all") {
    summaryMatch.$expr = {
      $eq: [
        {
          $ifNull: [
            "$summaries.resolvedModel",
            { $ifNull: ["$summaries.modelName", "$summaries.model"] },
          ],
        },
        filters.model,
      ],
    };
  }

  const entryPipeline: Record<string, unknown>[] = [];
  if (Object.keys(summaryMatch).length > 0) {
    entryPipeline.push({ $match: summaryMatch });
  }

  entryPipeline.push(
    { $sort: { "summaries.date": -1 } },
    { $limit: Math.min(Math.max(filters.limit ?? 100, 1), 500) },
    {
      $addFields: {
        summaryJobId: {
          $convert: {
            input: "$summaries.jobId",
            to: "objectId",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: "jobs",
        localField: "summaryJobId",
        foreignField: "_id",
        as: "summaryJob",
      },
    },
    {
      $project: {
        _id: 0,
        id: {
          $concat: [
            { $toString: "$_id" },
            ":",
            { $toString: "$summaryIndex" },
          ],
        },
        objectId: { $toString: "$_id" },
        objectName: { $ifNull: ["$name", "Untitled conversation"] },
        generatedAt: "$summaries.date",
        coverageStart: { $min: "$timeRanges.start" },
        coverageEnd: { $max: "$timeRanges.end" },
        requestedModel: {
          $ifNull: ["$summaries.requestedModel", "$summaries.model"],
        },
        executedModel: {
          $ifNull: [
            "$summaries.resolvedModel",
            { $ifNull: ["$summaries.modelName", "$summaries.model"] },
          ],
        },
        fallbackModel: "$summaries.fallbackModel",
        fallbackUsed: { $ifNull: ["$summaries.fallbackUsed", false] },
        promptName: "$summaries.promptName",
        text: "$summaries.text",
        usage: "$summaries.usage",
        jobId: "$summaries.jobId",
        jobState: { $arrayElemAt: ["$summaryJob.state", 0] },
        jobFinishedAt: { $arrayElemAt: ["$summaryJob.finishedAt", 0] },
      },
    },
  );

  const countPipeline: Record<string, unknown>[] = [];
  if (Object.keys(summaryMatch).length > 0) {
    countPipeline.push({ $match: summaryMatch });
  }
  countPipeline.push({ $count: "value" });

  return [
    { $match: { "summaries.0": { $exists: true } } },
    {
      $unwind: {
        path: "$summaries",
        includeArrayIndex: "summaryIndex",
      },
    },
    {
      $facet: {
        entries: entryPipeline,
        total: countPipeline,
        models: [
          {
            $project: {
              model: {
                $ifNull: [
                  "$summaries.resolvedModel",
                  { $ifNull: ["$summaries.modelName", "$summaries.model"] },
                ],
              },
              generatedAt: "$summaries.date",
            },
          },
          { $match: { model: { $type: "string", $ne: "" } } },
          {
            $group: {
              _id: "$model",
              count: { $sum: 1 },
              latestAt: { $max: "$generatedAt" },
            },
          },
          { $sort: { latestAt: -1, _id: 1 } },
          {
            $project: {
              _id: 0,
              model: "$_id",
              count: 1,
              latestAt: 1,
            },
          },
        ],
      },
    },
  ];
}

export function normalizeSummaryHistoryResult(
  result: unknown,
): SummaryHistoryResult {
  const facet = Array.isArray(result) ? result[0] : undefined;
  return {
    entries: Array.isArray(facet?.entries) ? facet.entries : [],
    models: Array.isArray(facet?.models) ? facet.models : [],
    total: facet?.total?.[0]?.value ?? 0,
  };
}

export function buildSummaryTaskPipeline(
  filters: SummaryTaskFilters,
): Record<string, unknown>[] {
  const commonMatch: Record<string, unknown> = {};
  const createdAt: Record<string, Date> = {};

  if (filters.from) createdAt.$gte = startOfLocalDay(filters.from);
  if (filters.to) createdAt.$lte = endOfLocalDay(filters.to);
  if (Object.keys(createdAt).length > 0) commonMatch.createdAt = createdAt;

  if (filters.model && filters.model !== "all") {
    commonMatch["data.model"] = filters.model;
  }

  const entryMatch: Record<string, unknown> = { ...commonMatch };
  switch (filters.status) {
    case "completed":
    case "failed":
    case "cancelled":
      entryMatch.state = filters.status;
      break;
    case "unfinished":
      entryMatch.state = { $in: ["active", "waiting", "delayed", "paused"] };
      break;
  }

  const countsMatch = Object.keys(commonMatch).length > 0
    ? [{ $match: commonMatch }]
    : [];

  return [
    { $match: { type: "summarization" } },
    {
      $facet: {
        entries: [
          ...(Object.keys(entryMatch).length > 0
            ? [{ $match: entryMatch }]
            : []),
          { $sort: { createdAt: -1 } },
          { $limit: Math.min(Math.max(filters.limit ?? 100, 1), 500) },
          {
            $project: {
              _id: 0,
              id: { $toString: "$_id" },
              state: 1,
              createdAt: 1,
              startedAt: 1,
              finishedAt: 1,
              failedReason: 1,
              requestedModel: { $ifNull: ["$data.model", "small"] },
              fallbackModel: "$data.fallbackModel",
              trigger: 1,
              progress: 1,
              result: 1,
            },
          },
        ],
        counts: [
          ...countsMatch,
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              completed: {
                $sum: { $cond: [{ $eq: ["$state", "completed"] }, 1, 0] },
              },
              unfinished: {
                $sum: {
                  $cond: [
                    {
                      $in: ["$state", [
                        "active",
                        "waiting",
                        "delayed",
                        "paused",
                      ]],
                    },
                    1,
                    0,
                  ],
                },
              },
              failed: {
                $sum: { $cond: [{ $eq: ["$state", "failed"] }, 1, 0] },
              },
              cancelled: {
                $sum: { $cond: [{ $eq: ["$state", "cancelled"] }, 1, 0] },
              },
            },
          },
          { $project: { _id: 0 } },
        ],
        models: [
          {
            $match: {
              "data.model": { $type: "string", $ne: "" },
            },
          },
          {
            $group: {
              _id: "$data.model",
              count: { $sum: 1 },
              latestAt: { $max: "$createdAt" },
            },
          },
          { $sort: { latestAt: -1, _id: 1 } },
          {
            $project: {
              _id: 0,
              model: "$_id",
              count: 1,
              latestAt: 1,
            },
          },
        ],
      },
    },
  ];
}

export function normalizeSummaryTaskResult(result: unknown): SummaryTaskResult {
  const facet = Array.isArray(result) ? result[0] : undefined;
  return {
    entries: Array.isArray(facet?.entries) ? facet.entries : [],
    models: Array.isArray(facet?.models) ? facet.models : [],
    counts: {
      total: facet?.counts?.[0]?.total ?? 0,
      completed: facet?.counts?.[0]?.completed ?? 0,
      unfinished: facet?.counts?.[0]?.unfinished ?? 0,
      failed: facet?.counts?.[0]?.failed ?? 0,
      cancelled: facet?.counts?.[0]?.cancelled ?? 0,
    },
  };
}
