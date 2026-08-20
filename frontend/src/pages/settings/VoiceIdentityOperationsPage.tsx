import { VoiceIdentityOperations } from "@/components/VoiceIdentityOperations";

export default function VoiceIdentityOperationsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Voice Identity operations
        </h2>
        <p className="text-sm text-muted-foreground">
          Run cheap classification against stored embeddings, fill missing
          diarization, or build a separate generation for comparison.
        </p>
      </div>
      <VoiceIdentityOperations />
    </div>
  );
}
