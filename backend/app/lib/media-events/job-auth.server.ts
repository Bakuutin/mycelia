import { type Db, ObjectId } from "mongodb";
import { z } from "zod";

const trustedMediaEventJobDataSchema = z.object({
  type: z.literal("mediaEventAggregation"),
  eventId: z.string().refine(ObjectId.isValid),
  profileSnapshot: z.record(z.string(), z.unknown()),
  consentReceiptId: z.string().min(1),
  retryNonce: z.string().min(1).optional(),
});

export type TrustedMediaEventJob =
  & z.infer<typeof trustedMediaEventJobDataSchema>
  & { owner: string; jobId: string };

export async function loadTrustedMediaEventJob(
  db: Db,
  principal: string,
  jobId: string,
  requestedEventId: string,
): Promise<TrustedMediaEventJob> {
  if (!ObjectId.isValid(jobId) || principal !== `job:${jobId}`) {
    throw new Error(
      "Media event processing is restricted to its signed worker job",
    );
  }
  const job = await db.collection("jobs").findOne({
    _id: new ObjectId(jobId),
    type: "mediaEventAggregation",
  }, { projection: { data: 1, trigger: 1 } });
  if (!job) throw new Error("Trusted media event job record was not found");

  const data = trustedMediaEventJobDataSchema.parse(job.data);
  if (data.eventId !== requestedEventId) {
    throw new Error(
      "Media event worker target does not match its persisted job",
    );
  }
  const owner = job.trigger?.principal;
  if (typeof owner !== "string" || !owner || owner === "server") {
    throw new Error("Media event job does not contain a trusted owner");
  }
  return { ...data, owner, jobId };
}
