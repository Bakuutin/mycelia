import { Button } from "@/components/ui/button";
import { Mic, Square } from "lucide-react";
import type { AudioRecordingReturn } from "@/hooks/useAudioRecording";

interface RecordingControlsProps {
  recording: AudioRecordingReturn;
}

export const RecordingControls = ({ recording }: RecordingControlsProps) => {
  const { isRecording, currentStep, startRecording, stopRecording } = recording;

  const isDisabled = currentStep !== "idle" && currentStep !== "error";
  const isLoading = currentStep === "mic" || currentStep === "websocket" ||
    currentStep === "audio-start" || currentStep === "stopping";

  return (
    <div className="flex flex-col items-center gap-4">
      {!isRecording
        ? (
          <Button
            onClick={startRecording}
            disabled={isDisabled || !recording.canAccessMicrophone}
            size="lg"
            className="h-16 w-16 rounded-full"
          >
            {isLoading
              ? (
                <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )
              : <Mic className="h-8 w-8" />}
          </Button>
        )
        : (
          <Button
            onClick={stopRecording}
            variant="destructive"
            size="lg"
            className="h-16 w-16 rounded-full"
          >
            <Square className="h-8 w-8" />
          </Button>
        )}

      {!recording.canAccessMicrophone && (
        <p className="text-sm text-muted-foreground text-center">
          Microphone access requires HTTPS or localhost
        </p>
      )}
    </div>
  );
};
