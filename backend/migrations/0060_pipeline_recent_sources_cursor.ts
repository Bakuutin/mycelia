import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const PIPELINE_RECENT_SOURCES_CURSOR_INDEX =
  "pipeline_recent_sources_cursor_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "source_files",
    { updatedAt: -1, start: -1, _id: -1 },
    { name: PIPELINE_RECENT_SOURCES_CURSOR_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  const sourceFiles = db.collection("source_files");
  if (await sourceFiles.indexExists(PIPELINE_RECENT_SOURCES_CURSOR_INDEX)) {
    await sourceFiles.dropIndex(PIPELINE_RECENT_SOURCES_CURSOR_INDEX);
  }
}
