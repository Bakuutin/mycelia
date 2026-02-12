import { Radio, RefreshCw } from "lucide-react";
import { useAudioRecording } from "@/hooks/useAudioRecording";
import { RecordingControls } from "@/components/audio/RecordingControls";
import { RecordingStatus } from "@/components/audio/RecordingStatus";
import { RecentRecordingsList } from "@/components/audio/RecentRecordingsList";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useSettingsStore } from "@/stores/settingsStore";

export default function CreateAudioRecordPage() {
  const recording = useAudioRecording();
  const {
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    setEchoCancellation,
    setNoiseSuppression,
    setAutoGainControl,
  } = useSettingsStore();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Radio className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Audio Recording</h1>
      </div>

      <Card className="p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="device-select">Input Device</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => recording.refreshDevices()}
              disabled={recording.isRecording}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          <Select
            value={recording.selectedDeviceId || undefined}
            onValueChange={(value) => recording.setSelectedDeviceId(value)}
            disabled={recording.isRecording}
          >
            <SelectTrigger id="device-select">
              <SelectValue placeholder="Select input device..." />
            </SelectTrigger>
            <SelectContent>
              {recording.availableDevices.length === 0
                ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No devices available
                  </div>
                )
                : (
                  recording.availableDevices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))
                )}
            </SelectContent>
          </Select>

          {recording.availableDevices.length === 0 && (
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <span className="text-sm text-muted-foreground">
                Microphone permission may be needed
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => recording.requestPermission()}
                disabled={recording.isRecording}
              >
                Request Permission
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sample-rate-select">Sample Rate</Label>
            <Select
              value={recording.sampleRate.toString()}
              onValueChange={(value) =>
                recording.setSampleRate(Number.parseInt(value, 10))}
              disabled={recording.isRecording}
            >
              <SelectTrigger id="sample-rate-select">
                <SelectValue placeholder="Select sample rate..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8000">8 kHz — Telephony, smallest files</SelectItem>
                <SelectItem value="16000">16 kHz — Speech recognition (recommended)</SelectItem>
                <SelectItem value="22050">22.05 kHz — Voice/podcast</SelectItem>
                <SelectItem value="44100">44.1 kHz — CD quality</SelectItem>
                <SelectItem value="48000">48 kHz — Professional audio</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              16 kHz is optimal for transcription. Higher rates improve quality but increase file size.
            </p>
          </div>

          <div className="space-y-3">
            <Label>Audio Processing</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col space-y-1.5 p-3 rounded-lg border bg-card">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="echo-cancellation"
                    checked={echoCancellation}
                    onCheckedChange={(checked) =>
                      setEchoCancellation(checked === true)}
                    disabled={recording.isRecording}
                  />
                  <Label
                    htmlFor="echo-cancellation"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Echo Cancellation
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Removes feedback from speakers. Enable when recording near playback.
                </p>
              </div>
              <div className="flex flex-col space-y-1.5 p-3 rounded-lg border bg-card">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="noise-suppression"
                    checked={noiseSuppression}
                    onCheckedChange={(checked) =>
                      setNoiseSuppression(checked === true)}
                    disabled={recording.isRecording}
                  />
                  <Label
                    htmlFor="noise-suppression"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Noise Suppression
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Reduces background noise (fans, AC). May slightly affect voice quality.
                </p>
              </div>
              <div className="flex flex-col space-y-1.5 p-3 rounded-lg border bg-card">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="auto-gain-control"
                    checked={autoGainControl}
                    onCheckedChange={(checked) =>
                      setAutoGainControl(checked === true)}
                    disabled={recording.isRecording}
                  />
                  <Label
                    htmlFor="auto-gain-control"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Auto Gain Control
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Automatically adjusts volume levels. Good for varying voice volumes.
                </p>
              </div>
            </div>
          </div>

          {!recording.canAccessMicrophone && (
            <p className="text-sm text-muted-foreground">
              Microphone access requires HTTPS or localhost
            </p>
          )}
        </div>
      </Card>

      <RecordingControls recording={recording} />

      <RecordingStatus recording={recording} />

      <RecentRecordingsList />
    </div>
  );
}
