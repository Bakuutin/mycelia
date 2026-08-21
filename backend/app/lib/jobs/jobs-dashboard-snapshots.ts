import { ObjectId } from "bson";

export const JOBS_DASHBOARD_SNAPSHOTS = "jobs_dashboard_snapshots";
export const JOB_RUN_HISTORY_DAILY = "job_run_history_daily";
export const RUN_HISTORY_SNAPSHOT_ID = "run_history:v1";
export const EXACT_BACKLOG_SNAPSHOT_ID = "exact_backlog:v1";
export const TIMELINE_INTEGRITY_SNAPSHOT_ID = "timeline_integrity:v1";
export const WORKER_CATALOG_SNAPSHOT_ID = "worker_catalog:v1";

const TERMINAL_STATES = ["completed", "failed", "cancelled"] as const;
const REFRESH_LEASE_MS = 10 * 60 * 1000;

type MongoCall = (input: any) => Promise<any>;

export type DashboardSnapshotState =
  | "missing"
  | "ready"
  | "refreshing"
  | "stale"
  | "failed";

export interface DashboardSnapshot<T = unknown> {
  _id: string;
  schemaVersion: number;
  state: DashboardSnapshotState;
  data?: T;
  asOf?: Date | string;
  lastAttemptAt?: Date | string;
  lastError?: string | null;
  operationId?: string;
  leaseUntil?: Date | string;
  committedCursor?: { updatedAt: Date | string; id: string } | null;
}

export async function readDashboardSnapshot<T = unknown>(
  mongo: MongoCall,
  id: string,
): Promise<DashboardSnapshot<T> | null> {
  return await mongo({
    action: "findOne",
    collection: JOBS_DASHBOARD_SNAPSHOTS,
    query: { _id: id },
  }) as DashboardSnapshot<T> | null;
}

export async function beginDashboardRefresh(
  mongo: MongoCall,
  id: string,
  operationId: string,
): Promise<DashboardSnapshot | null> {
  const now = new Date();
  await mongo({
    action: "updateOne",
    collection: JOBS_DASHBOARD_SNAPSHOTS,
    query: { _id: id },
    update: {
      $setOnInsert: {
        schemaVersion: 1,
        state: "missing",
        createdAt: now,
      },
    },
    options: { upsert: true, touchUpdatedAt: false },
  });

  return await mongo({
    action: "findOneAndUpdate",
    collection: JOBS_DASHBOARD_SNAPSHOTS,
    query: {
      _id: id,
      $or: [
        { state: { $ne: "refreshing" } },
        { leaseUntil: { $lte: now } },
        { leaseUntil: { $exists: false } },
      ],
    },
    update: {
      $set: {
        state: "refreshing",
        operationId,
        lastAttemptAt: now,
        leaseUntil: new Date(now.getTime() + REFRESH_LEASE_MS),
        lastError: null,
      },
    },
    options: { returnDocument: "after", touchUpdatedAt: false },
  }) as DashboardSnapshot | null;
}

export async function completeDashboardRefresh<T>(
  mongo: MongoCall,
  id: string,
  operationId: string,
  data: T,
  options: {
    asOf?: Date;
    committedCursor?: DashboardSnapshot["committedCursor"];
  } = {},
) {
  const asOf = options.asOf ?? new Date();
  await mongo({
    action: "updateOne",
    collection: JOBS_DASHBOARD_SNAPSHOTS,
    query: { _id: id, operationId },
    update: {
      $set: {
        schemaVersion: 1,
        state: "ready",
        data,
        asOf,
        lastSuccessfulAt: asOf,
        lastError: null,
        ...(options.committedCursor !== undefined
          ? { committedCursor: options.committedCursor }
          : {}),
      },
      $unset: { leaseUntil: "" },
    },
    options: { touchUpdatedAt: false },
  });
}

export async function failDashboardRefresh(
  mongo: MongoCall,
  id: string,
  operationId: string,
  error: unknown,
) {
  const existing = await readDashboardSnapshot(mongo, id);
  await mongo({
    action: "updateOne",
    collection: JOBS_DASHBOARD_SNAPSHOTS,
    query: { _id: id, operationId },
    update: {
      $set: {
        state: existing?.data === undefined ? "failed" : "stale",
        lastError: error instanceof Error ? error.message : String(error),
      },
      $unset: { leaseUntil: "" },
    },
    options: { touchUpdatedAt: false },
  });
}

function historyTimeExpression() {
  return { $ifNull: ["$finishedAt", "$createdAt"] };
}

function idleResultExpression() {
  const workerSpecific = [
    "vad",
    "conversation_chunk_creator",
    "conversation_extractor",
    "conversation_extractor_merged",
    "transcription_sequence_creator",
    "transcription",
  ];
  return {
    $or: [
      {
        $and: [
          { $eq: ["$type", "vad"] },
          {
            $eq: [{
              $ifNull: ["$result.hasSpeech", {
                $ifNull: ["$progress.hasSpeech", -1],
              }],
            }, 0],
          },
          {
            $eq: [{
              $ifNull: ["$result.processed", {
                $ifNull: ["$progress.processed", -1],
              }],
            }, 0],
          },
        ],
      },
      {
        $and: [
          { $eq: ["$type", "conversation_chunk_creator"] },
          { $eq: [{ $ifNull: ["$result.finalized", 0] }, 0] },
          { $eq: [{ $ifNull: ["$result.streamed", 0] }, 0] },
          { $eq: [{ $ifNull: ["$result.chunksCreated", 0] }, 0] },
        ],
      },
      {
        $and: [
          {
            $in: [
              "$type",
              ["conversation_extractor", "conversation_extractor_merged"],
            ],
          },
          { $eq: [{ $ifNull: ["$result.conversationsCreated", 0] }, 0] },
          { $eq: [{ $ifNull: ["$result.chunksProcessed", 0] }, 0] },
        ],
      },
      {
        $and: [
          { $eq: ["$type", "transcription_sequence_creator"] },
          { $eq: [{ $ifNull: ["$result.processed", 0] }, 0] },
        ],
      },
      {
        $and: [
          { $eq: ["$type", "transcription"] },
          {
            $eq: [{
              $ifNull: ["$result.processed", {
                $ifNull: ["$progress.processed", -1],
              }],
            }, 0],
          },
        ],
      },
      {
        $and: [
          { $not: [{ $in: ["$type", workerSpecific] }] },
          {
            $eq: [{
              $ifNull: ["$result.processed", {
                $ifNull: ["$progress.processed", -1],
              }],
            }, 0],
          },
          {
            $in: [{
              $ifNull: ["$result.total", {
                $ifNull: ["$progress.total", null],
              }],
            }, [null, 0]],
          },
        ],
      },
    ],
  };
}

function historyGroupPipeline(match: Record<string, unknown>) {
  return [
    { $match: match },
    { $set: { _historyAt: historyTimeExpression() } },
    { $match: { _historyAt: { $type: "date" } } },
    {
      $group: {
        _id: {
          type: "$type",
          dayUTC: { $dateTrunc: { date: "$_historyAt", unit: "day" } },
        },
        terminalRuns: { $sum: 1 },
        completed: {
          $sum: { $cond: [{ $eq: ["$state", "completed"] }, 1, 0] },
        },
        failed: {
          $sum: { $cond: [{ $eq: ["$state", "failed"] }, 1, 0] },
        },
        cancelled: {
          $sum: { $cond: [{ $eq: ["$state", "cancelled"] }, 1, 0] },
        },
        dismissedFailed: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$state", "failed"] },
                  { $ne: [{ $type: "$dismissedAt" }, "missing"] },
                ],
              },
              1,
              0,
            ],
          },
        },
        archivedRuns: {
          $sum: {
            $cond: [
              { $ne: [{ $type: "$archivedAt" }, "missing"] },
              1,
              0,
            ],
          },
        },
        emptyRuns: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$state", "completed"] },
                  idleResultExpression(),
                ],
              },
              1,
              0,
            ],
          },
        },
        idleAutoRuns: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$state", "completed"] },
                  { $eq: ["$trigger.type", "auto"] },
                  idleResultExpression(),
                ],
              },
              1,
              0,
            ],
          },
        },
        recentTimestamps: {
          $topN: {
            n: 20,
            sortBy: { _historyAt: -1 },
            output: "$_historyAt",
          },
        },
      },
    },
  ];
}

function rollupOperation(row: any) {
  return {
    updateOne: {
      filter: { dayUTC: row._id.dayUTC, type: row._id.type },
      update: {
        $set: {
          dayUTC: row._id.dayUTC,
          type: row._id.type,
          terminalRuns: Number(row.terminalRuns ?? 0),
          completed: Number(row.completed ?? 0),
          failed: Number(row.failed ?? 0),
          cancelled: Number(row.cancelled ?? 0),
          dismissedFailed: Number(row.dismissedFailed ?? 0),
          archivedRuns: Number(row.archivedRuns ?? 0),
          emptyRuns: Number(row.emptyRuns ?? 0),
          idleAutoRuns: Number(row.idleAutoRuns ?? 0),
          recentTimestamps: row.recentTimestamps ?? [],
        },
      },
      upsert: true,
    },
  };
}

function formatAverageFrequency(timestamps: number[]) {
  if (timestamps.length < 2) return "-";
  let gap = 0;
  for (let index = 0; index < timestamps.length - 1; index++) {
    gap += timestamps[index] - timestamps[index + 1];
  }
  const average = gap / (timestamps.length - 1);
  if (average < 60_000) return `~${Math.round(average / 1_000)}s`;
  if (average < 3_600_000) return `~${Math.round(average / 60_000)}m`;
  return `~${(average / 3_600_000).toFixed(1)}h`;
}

async function composeRunHistoryData(mongo: MongoCall) {
  const rows = await mongo({
    action: "find",
    collection: JOB_RUN_HISTORY_DAILY,
    query: {},
    options: { projection: { _id: 0 }, sort: { dayUTC: -1, type: 1 } },
  }) as any[];
  const byType = new Map<string, any>();
  for (const row of rows) {
    const current = byType.get(row.type) ?? {
      type: row.type,
      terminalRuns: 0,
      totalRuns: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      dismissedFailed: 0,
      archivedRuns: 0,
      recentTimestamps: [] as number[],
      active: 0,
      staleActive: 0,
      staleClaims: 0,
      waiting: 0,
      delayed: 0,
      emptyRuns: 0,
      idleAutoRuns: 0,
    };
    for (
      const key of [
        "terminalRuns",
        "completed",
        "failed",
        "cancelled",
        "dismissedFailed",
        "archivedRuns",
        "emptyRuns",
        "idleAutoRuns",
      ]
    ) current[key] += Number(row[key] ?? 0);
    current.totalRuns = current.terminalRuns;
    current.recentTimestamps.push(
      ...(row.recentTimestamps ?? []).map((value: Date | string) =>
        new Date(value).getTime()
      ),
    );
    byType.set(row.type, current);
  }

  const stats = [...byType.values()].map((row) => {
    const timestamps = row.recentTimestamps.sort((a: number, b: number) =>
      b - a
    ).slice(0, 20);
    const outcomeRuns = row.completed + row.failed;
    return {
      ...row,
      recentTimestamps: undefined,
      successRate: outcomeRuns === 0 ? 0 : row.completed / outcomeRuns * 100,
      avgFrequency: formatAverageFrequency(timestamps),
    };
  });
  const totals = stats.reduce(
    (result, row) => {
      result.completed += row.completed;
      result.failed += row.failed;
      result.cancelled += row.cancelled;
      result.total += row.terminalRuns;
      return result;
    },
    {
      active: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      cancelled: 0,
      total: 0,
    },
  );
  return { stats, totals };
}

function cursorQuery(
  cursor: DashboardSnapshot["committedCursor"],
  cutoff: Date,
) {
  if (!cursor) return { updatedAt: { $lte: cutoff } };
  const updatedAt = new Date(cursor.updatedAt);
  const id = new ObjectId(cursor.id);
  return {
    updatedAt: { $lte: cutoff },
    $or: [
      { updatedAt: { $gt: updatedAt } },
      { updatedAt, _id: { $gt: id } },
    ],
  };
}

async function latestCursorAt(mongo: MongoCall, cutoff: Date) {
  const row = await mongo({
    action: "findOne",
    collection: "jobs",
    query: { updatedAt: { $lte: cutoff } },
    options: {
      sort: { updatedAt: -1, _id: -1 },
      projection: { _id: 1, updatedAt: 1 },
    },
  });
  return row ? { updatedAt: row.updatedAt, id: row._id.toString() } : null;
}

export async function refreshRunHistorySnapshot(
  mongo: MongoCall,
  operationId: string,
  acquiredLease?: DashboardSnapshot,
) {
  const lease = acquiredLease ?? await beginDashboardRefresh(
    mongo,
    RUN_HISTORY_SNAPSHOT_ID,
    operationId,
  );
  if (!lease) return { accepted: false, reason: "already_refreshing" };
  const cutoff = new Date();
  try {
    const previousCursor = lease.committedCursor ?? null;
    const mode: "seed" | "incremental" = previousCursor
      ? "incremental"
      : "seed";
    let changedJobs = 0;
    let rebuiltDays = 0;
    let committedCursor = previousCursor;

    if (!previousCursor) {
      const rows = await mongo({
        action: "aggregate",
        collection: "jobs",
        pipeline: historyGroupPipeline({
          state: { $in: TERMINAL_STATES },
          $or: [
            { updatedAt: { $lte: cutoff } },
            { updatedAt: { $exists: false } },
          ],
        }),
        options: { allowDiskUse: true, maxTimeMS: 120_000 },
      }) as any[];
      await mongo({
        action: "deleteMany",
        collection: JOB_RUN_HISTORY_DAILY,
        query: {},
      });
      if (rows.length > 0) {
        await mongo({
          action: "bulkWrite",
          collection: JOB_RUN_HISTORY_DAILY,
          operations: rows.map(rollupOperation),
          options: { ordered: false, touchUpdatedAt: false },
        });
      }
      rebuiltDays = rows.length;
      committedCursor = await latestCursorAt(mongo, cutoff);
    } else {
      const affected = new Map<
        string,
        { type: string; dayUTC: Date }
      >();
      let scanCursor = previousCursor;
      while (true) {
        const rows = await mongo({
          action: "find",
          collection: "jobs",
          query: cursorQuery(scanCursor, cutoff),
          options: {
            sort: { updatedAt: 1, _id: 1 },
            limit: 2_000,
            projection: {
              _id: 1,
              type: 1,
              state: 1,
              updatedAt: 1,
              finishedAt: 1,
              createdAt: 1,
            },
            hint: "jobs_dashboard_updated_cursor_v1",
            maxTimeMS: 10_000,
          },
        }) as any[];
        if (rows.length === 0) break;
        changedJobs += rows.length;
        for (const row of rows) {
          if (!TERMINAL_STATES.includes(row.state)) continue;
          const time = row.finishedAt ?? row.createdAt;
          if (!time) continue;
          const date = new Date(time);
          const dayUTC = new Date(Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
          ));
          affected.set(`${row.type}:${dayUTC.toISOString()}`, {
            type: row.type,
            dayUTC,
          });
        }
        const last = rows.at(-1)!;
        scanCursor = {
          updatedAt: last.updatedAt,
          id: last._id.toString(),
        };
        if (rows.length < 2_000) break;
      }
      committedCursor = scanCursor;

      for (const { type, dayUTC } of affected.values()) {
        const nextDay = new Date(dayUTC.getTime() + 24 * 60 * 60 * 1_000);
        const rows = await mongo({
          action: "aggregate",
          collection: "jobs",
          pipeline: historyGroupPipeline({
            type,
            state: { $in: TERMINAL_STATES },
            $or: [
              { finishedAt: { $gte: dayUTC, $lt: nextDay } },
              {
                finishedAt: { $exists: false },
                createdAt: { $gte: dayUTC, $lt: nextDay },
              },
            ],
          }),
          options: { maxTimeMS: 10_000 },
        }) as any[];
        if (rows[0]) {
          await mongo({
            action: "bulkWrite",
            collection: JOB_RUN_HISTORY_DAILY,
            operations: [rollupOperation(rows[0])],
            options: { ordered: true, touchUpdatedAt: false },
          });
        } else {
          await mongo({
            action: "deleteOne",
            collection: JOB_RUN_HISTORY_DAILY,
            query: { type, dayUTC },
          });
        }
      }
      rebuiltDays = affected.size;
    }

    const data = await composeRunHistoryData(mongo);
    await completeDashboardRefresh(
      mongo,
      RUN_HISTORY_SNAPSHOT_ID,
      operationId,
      {
        ...data,
        refresh: { mode, changedJobs, rebuiltDays },
      },
      { asOf: cutoff, committedCursor },
    );
    return { accepted: true, mode, changedJobs, rebuiltDays };
  } catch (error) {
    await failDashboardRefresh(
      mongo,
      RUN_HISTORY_SNAPSHOT_ID,
      operationId,
      error,
    );
    throw error;
  }
}

export function serializeDashboardSnapshot<T>(
  snapshot: DashboardSnapshot<T> | null,
) {
  if (!snapshot) return { state: "missing" as const, data: undefined };
  return {
    state: snapshot.state,
    schemaVersion: snapshot.schemaVersion,
    data: snapshot.data,
    asOf: snapshot.asOf ? new Date(snapshot.asOf).toISOString() : undefined,
    lastAttemptAt: snapshot.lastAttemptAt
      ? new Date(snapshot.lastAttemptAt).toISOString()
      : undefined,
    lastError: snapshot.lastError ?? undefined,
    operationId: snapshot.operationId,
  };
}
