import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEX_NAME = "jobs_diarizator_admission_queue_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "jobs",
    {
      "queueAdmission.state": 1,
      state: 1,
      priority: 1,
      createdAt: 1,
    },
    {
      name: INDEX_NAME,
      partialFilterExpression: {
        "queueAdmission.state": "waiting_for_diarizator_slot",
      },
    },
  );
}

export async function down(db: Db): Promise<void> {
  const jobs = db.collection("jobs");
  if (await jobs.indexExists(INDEX_NAME)) {
    await jobs.dropIndex(INDEX_NAME);
  }
}
