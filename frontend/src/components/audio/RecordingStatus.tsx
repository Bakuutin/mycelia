import { Card } from "@/components/ui/card";
import type { AudioRecordingReturn } from "@/hooks/useAudioRecording";
import { AudioVisualizer } from "./AudioVisualizer";

interface RecordingStatusProps {
  recording: AudioRecordingReturn;
}

const stepLabels: Record<string, string> = {
  idle: "Ready",
  mic: "Requesting microphone access...",
  websocket: "Connecting to server...",
  "audio-start": "Starting audio session...",
  streaming: "Recording",
  stopping: "Stopping...",
  error: "Error",
};

export const RecordingStatus = ({ recording }: RecordingStatusProps) => {
  const { currentStep, isRecording, recordingDuration, formatDuration, error } =
    recording;

  return (
    <Card className="p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Status:</span>
          <span className="text-sm">
            {stepLabels[currentStep] || currentStep}
          </span>
        </div>

        {isRecording && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Duration:</span>
            <span className="text-sm font-mono">
              {formatDuration(recordingDuration)}
            </span>
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive mt-2">
            Error: {error}
          </div>
        )}

        <AudioVisualizer recording={recording} />
      </div>
    </Card>
  );
};
