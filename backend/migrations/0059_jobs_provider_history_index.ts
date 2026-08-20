import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const JOBS_PROVIDER_HISTORY_INDEX =
  "jobs_provider_type_state_createdAt_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "jobs",
    {
      "data.routingContext.providerProfileId": 1,
      type: 1,
      state: 1,
      createdAt: -1,
    },
    {
      name: JOBS_PROVIDER_HISTORY_INDEX,
      partialFilterExpression: {
        "data.routingContext.providerProfileId": { $exists: true },
      },
    },
  );
}

export async function down(db: Db): Promise<void> {
  const jobs = db.collection("jobs");
  if (await jobs.indexExists(JOBS_PROVIDER_HISTORY_INDEX)) {
    await jobs.dropIndex(JOBS_PROVIDER_HISTORY_INDEX);
  }
}
