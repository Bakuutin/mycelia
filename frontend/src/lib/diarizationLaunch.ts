export type DiarizationCampaign = {
  campaignId: string;
  status: string;
  range?: { start?: string | Date; end?: string | Date };
  processedChunks?: number;
  totalChunks?: number;
  etaSeconds?: number | null;
};

export function buildDiarizationLaunchData(input: {
  start: Date;
  end: Date;
  batchSequences: number;
}) {
  return {
    type: "diarization" as const,
    mode: "missing" as const,
    start: input.start,
    end: input.end,
    limit: input.batchSequences,
    batchSize: input.batchSequences,
  };
}

export function findOverlappingCampaign(
  campaigns: DiarizationCampaign[],
  start: Date,
  end: Date,
) {
  return campaigns.find((campaign) => {
    if (!["counting", "running"].includes(campaign.status)) return false;
    const campaignStart = campaign.range?.start
      ? new Date(campaign.range.start)
      : null;
    const campaignEnd = campaign.range?.end
      ? new Date(campaign.range.end)
      : null;
    return campaignStart && campaignEnd && campaignStart < end &&
      campaignEnd > start;
  });
}
