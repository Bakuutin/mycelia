import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db): Promise<void> {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) =>
      entry.name
    ),
  );
  if (!existing.has("media_original_deletion_previews")) {
    await db.createCollection("media_original_deletion_previews");
  }
  await ensureIndexExists(
    db,
    "media_original_deletion_previews",
    { expiresAt: 1 },
    {
      name: "media_original_deletion_preview_ttl_v1",
      expireAfterSeconds: 0,
    },
  );
  await ensureIndexExists(
    db,
    "media_original_deletion_previews",
    { owner: 1, assetId: 1, createdAt: -1 },
    { name: "media_original_deletion_asset_v1" },
  );
  await ensureIndexExists(
    db,
    "media_originals.files",
    { "metadata.state": 1, "metadata.expiresAt": 1 },
    { name: "media_original_staging_expiry_v1" },
  );
  await ensureIndexExists(
    db,
    "media_previews.files",
    { "metadata.state": 1, "metadata.expiresAt": 1 },
    { name: "media_preview_staging_expiry_v1" },
  );
}

export async function down(db: Db): Promise<void> {
  const indexes: Array<[string, string]> = [
    [
      "media_original_deletion_previews",
      "media_original_deletion_preview_ttl_v1",
    ],
    [
      "media_original_deletion_previews",
      "media_original_deletion_asset_v1",
    ],
    ["media_originals.files", "media_original_staging_expiry_v1"],
    ["media_previews.files", "media_preview_staging_expiry_v1"],
  ];
  for (const [collection, name] of indexes) {
    if (await db.collection(collection).indexExists(name)) {
      await db.collection(collection).dropIndex(name);
    }
  }
}
