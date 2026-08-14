import { expect } from "@std/expect";
import { releaseTranscriptionSequenceClaimsForJob } from "./transcription-claim-reaper.ts";

Deno.test("releases only transcription sequences claimed by the failed job", async () => {
  const requests: any[] = [];
  const mongo = (request: any) => {
    requests.push(request);
    return Promise.resolve({ modifiedCount: 2 });
  };

  const released = await releaseTranscriptionSequenceClaimsForJob(
    mongo,
    "job-123",
  );

  expect(released).toBe(2);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    action: "updateMany",
    collection: "transcription_sequences",
    query: {
      state: "processing",
      processedByJobId: "job-123",
    },
    update: {
      $set: { state: "ready" },
      $unset: { processedByJobId: "" },
    },
  });
  expect(requests[0].update.$set.updatedAt).toBeInstanceOf(Date);
});
