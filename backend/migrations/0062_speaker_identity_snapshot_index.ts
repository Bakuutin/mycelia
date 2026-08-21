import type { Db } from "mongodb";
import { SPEAKER_IDENTITY_SNAPSHOT_INDEX } from "@/lib/speakers/calibration-contract.ts";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "diarizations",
    {
      lifecycleStatus: 1,
      "speakerIdentity.calibrationId": 1,
      "speakerIdentity.profileRevision": 1,
      "speakerIdentity.embeddingSpaceId": 1,
      "speakerIdentity.source": 1,
      "speakerIdentity.identityState": 1,
    },
    { name: SPEAKER_IDENTITY_SNAPSHOT_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (
    await db.collection("diarizations").indexExists(
      SPEAKER_IDENTITY_SNAPSHOT_INDEX,
    )
  ) {
    await db.collection("diarizations").dropIndex(
      SPEAKER_IDENTITY_SNAPSHOT_INDEX,
    );
  }
}
