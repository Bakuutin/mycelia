import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const collectionName = "gcp_usage_months";
const legacyIndex = "gcp_usage_owner_month_v1";
const projectIndex = "gcp_usage_project_month_v1";

export async function up(db: Db): Promise<void> {
  const collection = db.collection(collectionName);
  if (await collection.indexExists(legacyIndex)) {
    await collection.dropIndex(legacyIndex);
  }
  await ensureIndexExists(db, collectionName, { projectId: 1, month: 1 }, {
    name: projectIndex,
    unique: true,
    partialFilterExpression: { projectId: { $type: "string" } },
  });
}

export async function down(db: Db): Promise<void> {
  const collection = db.collection(collectionName);
  if (await collection.indexExists(projectIndex)) {
    await collection.dropIndex(projectIndex);
  }
  await ensureIndexExists(db, collectionName, { owner: 1, month: 1 }, {
    name: legacyIndex,
    unique: true,
  });
}
