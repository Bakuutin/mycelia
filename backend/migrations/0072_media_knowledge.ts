import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const collections = [
  "media_imports",
  "media_assets",
  "media_metadata_versions",
  "media_analysis_runs",
  "media_ocr_pages",
  "media_annotations",
  "gcp_usage_events",
  "gcp_usage_months",
] as const;

export async function up(db: Db): Promise<void> {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) =>
      c.name
    ),
  );
  for (const name of collections) {
    if (!existing.has(name)) await db.createCollection(name);
  }

  await ensureIndexExists(db, "media_imports", { expiresAt: 1 }, {
    name: "media_import_preview_ttl_v1",
    expireAfterSeconds: 0,
  });
  await ensureIndexExists(db, "media_assets", { owner: 1, sha256: 1 }, {
    name: "media_asset_owner_sha256_v1",
    unique: true,
  });
  await ensureIndexExists(
    db,
    "media_assets",
    { owner: 1, capturedAt: -1, _id: -1 },
    { name: "media_asset_timeline_v1" },
  );
  await ensureIndexExists(
    db,
    "media_assets",
    { owner: 1, status: 1, updatedAt: -1 },
    { name: "media_asset_status_v1" },
  );
  await ensureIndexExists(
    db,
    "media_analysis_runs",
    { assetId: 1, createdAt: -1 },
    { name: "media_runs_asset_v1" },
  );
  await ensureIndexExists(
    db,
    "media_analysis_runs",
    { runKey: 1 },
    { name: "media_runs_key_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "media_ocr_pages",
    { runId: 1, pageNumber: 1 },
    { name: "media_ocr_run_page_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "media_ocr_pages",
    { text: "text" },
    { name: "media_ocr_text_v1", default_language: "none" },
  );
  await ensureIndexExists(
    db,
    "media_annotations",
    { assetId: 1, active: 1, label: 1 },
    { name: "media_annotations_asset_v1" },
  );
  await ensureIndexExists(
    db,
    "gcp_usage_events",
    { attemptId: 1 },
    { name: "gcp_usage_attempt_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "gcp_usage_months",
    { owner: 1, month: 1 },
    { name: "gcp_usage_owner_month_v1", unique: true },
  );
}

export async function down(db: Db): Promise<void> {
  // Canonical assets and originals must survive a code rollback. Only indexes
  // owned by this migration are removed.
  const indexes: Record<string, string[]> = {
    media_imports: ["media_import_preview_ttl_v1"],
    media_assets: [
      "media_asset_owner_sha256_v1",
      "media_asset_timeline_v1",
      "media_asset_status_v1",
    ],
    media_analysis_runs: ["media_runs_asset_v1", "media_runs_key_v1"],
    media_ocr_pages: ["media_ocr_run_page_v1", "media_ocr_text_v1"],
    media_annotations: ["media_annotations_asset_v1"],
    gcp_usage_events: ["gcp_usage_attempt_v1"],
    gcp_usage_months: ["gcp_usage_owner_month_v1"],
  };
  for (const [collection, names] of Object.entries(indexes)) {
    for (const name of names) {
      if (await db.collection(collection).indexExists(name)) {
        await db.collection(collection).dropIndex(name);
      }
    }
  }
}
