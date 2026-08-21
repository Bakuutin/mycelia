import { type Db, ObjectId } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db): Promise<void> {
  const exists = await db.listCollections(
    { name: "media_visual_descriptions" },
    { nameOnly: true },
  ).hasNext();
  if (!exists) await db.createCollection("media_visual_descriptions");

  await ensureIndexExists(
    db,
    "media_visual_descriptions",
    { runId: 1 },
    { name: "media_visual_run_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "media_visual_descriptions",
    { assetId: 1, active: 1 },
    { name: "media_visual_asset_v1" },
  );
  await ensureIndexExists(
    db,
    "media_visual_descriptions",
    { searchText: "text" },
    { name: "media_visual_text_v1", default_language: "none" },
  );

  // Tighten only the exact prototype defaults. Explicit user-customized
  // budgets remain untouched.
  await db.collection("configs").updateOne(
    {
      _id: new ObjectId("000000000000000000000000"),
      "mediaKnowledge.promoGuard.monthlyGrossLimitUsd": 45,
      "mediaKnowledge.promoGuard.dailyGrossLimitUsd": 5,
      "mediaKnowledge.promoGuard.perImportGrossLimitUsd": 1,
    },
    {
      $set: {
        "mediaKnowledge.promoGuard.monthlyGrossLimitUsd": 1,
        "mediaKnowledge.promoGuard.dailyGrossLimitUsd": 0.1,
        "mediaKnowledge.promoGuard.perImportGrossLimitUsd": 0.01,
      },
    },
  );
}

export async function down(db: Db): Promise<void> {
  for (
    const name of [
      "media_visual_run_v1",
      "media_visual_asset_v1",
      "media_visual_text_v1",
    ]
  ) {
    if (await db.collection("media_visual_descriptions").indexExists(name)) {
      await db.collection("media_visual_descriptions").dropIndex(name);
    }
  }
}
