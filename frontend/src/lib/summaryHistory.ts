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
