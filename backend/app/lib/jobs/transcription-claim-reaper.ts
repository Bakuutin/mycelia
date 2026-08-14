type MongoResource = (input: any) => Promise<any>;

export async function releaseTranscriptionSequenceClaimsForJob(
  mongo: MongoResource,
  jobId: string,
): Promise<number> {
  const result = await mongo({
    action: "updateMany",
    collection: "transcription_sequences",
    query: {
      state: "processing",
      processedByJobId: jobId,
    },
    update: {
      $set: { state: "ready", updatedAt: new Date() },
      $unset: { processedByJobId: "" },
    },
  });
  return result.modifiedCount ?? 0;
}
