type DiarizationGenerationInput = {
  type?: string;
  mode?: string;
  runId?: string;
};

type DiarizationRun = {
  runId?: string;
  status?: string;
} | null | undefined;

export function assertDiarizationGenerationReady(
  input: DiarizationGenerationInput,
  run: DiarizationRun,
): void {
  if (input.type !== "diarization" || input.mode !== "build_generation") {
    return;
  }
  if (!input.runId) {
    throw new Error(
      "A runId is required. Create a new diarization generation before enqueueing this job.",
    );
  }
  if (!run || run.runId !== input.runId || run.status !== "building") {
    throw new Error(
      `Diarization run ${input.runId} is not building. Create a new diarization generation instead of rerunning stale input.`,
    );
  }
}
