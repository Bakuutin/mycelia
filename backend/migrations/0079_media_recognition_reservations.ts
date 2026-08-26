import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const COLLECTION = "media_recognition_asset_reservations";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, COLLECTION);
  await ensureIndexExists(
    db,
    COLLECTION,
    { owner: 1, assetId: 1 },
    { name: "media_recognition_reservation_owner_asset_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    COLLECTION,
    { batchId: 1 },
    { name: "media_recognition_reservation_batch_v1" },
  );
  await ensureIndexExists(
    db,
    COLLECTION,
    { expiresAt: 1 },
    {
      name: "media_recognition_reservation_preparing_ttl_v1",
      expireAfterSeconds: 0,
    },
  );
}

export async function down(db: Db): Promise<void> {
  for (
    const name of [
      "media_recognition_reservation_owner_asset_v1",
      "media_recognition_reservation_batch_v1",
      "media_recognition_reservation_preparing_ttl_v1",
    ]
  ) {
    if (await db.collection(COLLECTION).indexExists(name)) {
      await db.collection(COLLECTION).dropIndex(name);
    }
  }
  // Durable batch reservations may still protect queued provider work. Keep the
  // collection and its records on rollback; the canonical media assets remain
  // untouched.
}
