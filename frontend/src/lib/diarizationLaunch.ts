export type DiarizationCampaign = {
  campaignId: string;
  status: string;
  range?: { start?: string | Date; end?: string | Date };
  processedChunks?: number;
  totalChunks?: number;
  etaSeconds?: number | null;
};

export function buildDiarizationLaunchData(input: {
  start?: Date;
  end?: Date;
  batchSequences: number;
}) {
  return {
    type: "diarization" as const,
    mode: "missing" as const,
    ...(input.start ? { start: input.start } : {}),
    ...(input.end ? { end: input.end } : {}),
    limit: input.batchSequences,
    batchSize: input.batchSequences,
  };
}

export function findOverlappingCampaign(
  campaigns: DiarizationCampaign[],
  start?: Date,
  end?: Date,
) {
  const requestedStart = start?.getTime() ?? Number.NEGATIVE_INFINITY;
  const requestedEnd = end?.getTime() ?? Number.POSITIVE_INFINITY;
  return campaigns.find((campaign) => {
    if (!["counting", "running"].includes(campaign.status)) return false;
    const campaignStart = campaign.range?.start
      ? new Date(campaign.range.start).getTime()
      : Number.NEGATIVE_INFINITY;
    const campaignEnd = campaign.range?.end
      ? new Date(campaign.range.end).getTime()
      : Number.POSITIVE_INFINITY;
    return campaignStart < requestedEnd && campaignEnd > requestedStart;
  });
}
