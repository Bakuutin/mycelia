type DiarizationJobInput = {
  type?: string;
  mode?: string;
  start?: string;
  end?: string;
  limit?: number;
  [key: string]: unknown;
};

type DiarizationRun = {
  runId: string;
  status: string;
  generation: number;
};

type DiarizatorMetadata = {
  embeddingSpaceId?: unknown;
  diarizationFingerprint?: unknown;
};

export function buildFreshDiarizationGeneration(
  input: DiarizationJobInput,
  runs: DiarizationRun[],
  metadata: DiarizatorMetadata,
  now = new Date(),
) {
  if (!metadata.embeddingSpaceId || !metadata.diarizationFingerprint) {
    throw new Error(
      "Healthy diarizator fingerprint metadata is required to create a new generation.",
    );
  }
  const runId = `diar-${now.toISOString().replace(/[:.]/g, "-")}`;
  const activeRun = runs.find((run) => run.status === "active");
  const generation = Math.max(0, ...runs.map((run) => run.generation)) + 1;
  const range = {
    ...(typeof input.start === "string" ? { start: input.start } : {}),
    ...(typeof input.end === "string" ? { end: input.end } : {}),
  };

  return {
    runId,
    createRun: {
      action: "create-run",
      runId,
      mode: "rediarize",
      generation,
      ...range,
      replacesRunId: activeRun?.runId,
      diarizationFingerprint: metadata.diarizationFingerprint,
      embeddingSpaceId: metadata.embeddingSpaceId,
    },
    jobData: {
      type: "diarization",
      mode: "build_generation",
      runId,
      ...range,
      limit: typeof input.limit === "number" ? input.limit : 4,
    },
  };
}
