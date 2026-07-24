import { normalizeObjectId } from "@/lib/diarization";

export interface SpeakerAssignmentTarget {
  id: unknown;
  originalId?: unknown;
  speaker?: string;
}

export type SpeakerAssignmentScope = "segment" | "speaker";

export function buildSpeakerAssignmentQuery(
  target: SpeakerAssignmentTarget,
  scope: SpeakerAssignmentScope,
): Record<string, unknown> {
  const id = normalizeObjectId(target.id);
  if (!id) throw new Error("Diarization segment has no valid ID");

  if (scope === "segment") {
    return { _id: { $oid: id } };
  }

  const originalId = normalizeObjectId(target.originalId);
  if (!originalId || !target.speaker) {
    throw new Error(
      "Recording and speaker label are required for group assignment",
    );
  }

  return {
    original_id: { $oid: originalId },
    speaker: target.speaker,
  };
}

export function normalizeSpeakerEmbedding(embedding: number[]): number[] {
  const norm = Math.sqrt(
    embedding.reduce((sum, value) => sum + value * value, 0),
  );
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("This segment does not contain a usable speaker embedding");
  }
  return embedding.map((value) => value / norm);
}
