import { type Db, ObjectId } from "mongodb";
import { z } from "zod";
import { zMediaRecognitionTask } from "@myceliasdk/media.ts";

const trustedMediaJobDataSchema = z.object({
  type: z.literal("mediaRecognition"),
  assetId: z.string().refine(ObjectId.isValid),
  profileSnapshot: z.record(z.string(), z.unknown()),
  requestedTasks: z.array(zMediaRecognitionTask).min(1).max(4).optional(),
  consentReceiptId: z.string().min(1),
  recognitionBatchId: z.string().refine(ObjectId.isValid).optional(),
});

export type TrustedMediaRecognitionJob =
  & z.infer<
    typeof trustedMediaJobDataSchema
  >
  & { owner: string; jobId: string };

export async function loadTrustedMediaRecognitionJob(
  db: Db,
  principal: string,
  jobId: string,
  requestedAssetId: string,
): Promise<TrustedMediaRecognitionJob> {
  if (!ObjectId.isValid(jobId) || principal !== `job:${jobId}`) {
    throw new Error("Media processing is restricted to its signed worker job");
  }
  const job = await db.collection("jobs").findOne({
    _id: new ObjectId(jobId),
    type: "mediaRecognition",
  }, { projection: { data: 1, trigger: 1 } });
  if (!job) throw new Error("Trusted media job record was not found");

  const data = trustedMediaJobDataSchema.parse(job.data);
  if (data.assetId !== requestedAssetId) {
    throw new Error("Media worker asset does not match its persisted job");
  }
  const owner = job.trigger?.principal;
  if (typeof owner !== "string" || !owner || owner === "server") {
    throw new Error("Media job does not contain a trusted asset owner");
  }
  return { ...data, owner, jobId };
}
