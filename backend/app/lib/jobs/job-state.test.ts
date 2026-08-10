import { expect } from "@std/expect";
import {
  diarizationCampaignIdForJob,
  isCancelledJobRecord,
} from "./job-state.ts";

Deno.test("cancelled jobs cannot be revived by a stale BullMQ lock", () => {
  expect(isCancelledJobRecord({ state: "cancelled" })).toBe(true);
  expect(isCancelledJobRecord({ state: "active" })).toBe(false);
  expect(isCancelledJobRecord(undefined)).toBe(false);
});

Deno.test("diarization cancellation resolves explicit and legacy campaign ids", () => {
  expect(diarizationCampaignIdForJob("job-1", { campaignId: "campaign-1" }))
    .toBe("campaign-1");
  expect(diarizationCampaignIdForJob("job-1", {})).toBe(
    "diarization-job-1",
  );
});
