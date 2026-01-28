import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlayPauseButton } from "@/modules/audio/PlayPauseButton";
import { AudioPlayer, useAudioPlayer } from "@/modules/audio/player";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatTime } from "@/lib/formatTime";

interface ObjectAudioPlayerProps {
  timeRange: { start: Date | string; end?: Date | string | null };
}

const SPEED_OPTIONS = [
  { value: 0.5, label: "0.5x" },
  { value: 0.75, label: "0.75x" },
  { value: 1, label: "1x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 1.75, label: "1.75x" },
  { value: 2, label: "2x" },
  { value: 2.5, label: "2.5x" },
  { value: 3, label: "3x" },
];

export function ObjectAudioPlayer({ timeRange }: ObjectAudioPlayerProps) {
  const { currentDate, isPlaying, resetDate } = useAudioPlayer();
  const { volume, setVolume, playbackRate, setPlaybackRate, timeFormat } = useSettingsStore();
  const hasInitialized = useRef(false);

  const startDate = typeof timeRange.start === "string"
    ? new Date(timeRange.start)
    : timeRange.start;

  const endDate = timeRange.end
    ? (typeof timeRange.end === "string" ? new Date(timeRange.end) : timeRange.end)
    : null;

  // Initialize player to start of time range when first mounted
  useEffect(() => {
    if (!hasInitialized.current && startDate) {
      resetDate(startDate);
      hasInitialized.current = true;
    }
  }, [startDate, resetDate]);

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0]);
  };

  const handleSpeedChange = (value: string) => {
    setPlaybackRate(parseFloat(value));
  };

  // Calculate progress within the time range
  const getProgress = () => {
    if (!currentDate || !startDate) return 0;
    const current = currentDate.getTime();
    const start = startDate.getTime();
    const end = endDate ? endDate.getTime() : start + 60 * 60 * 1000; // Default to 1 hour if no end
    const progress = ((current - start) / (end - start)) * 100;
    return Math.max(0, Math.min(100, progress));
  };

  // Format elapsed time
  const getElapsedTime = () => {
    if (!currentDate || !startDate) return "0:00";
    const elapsedMs = currentDate.getTime() - startDate.getTime();
    if (elapsedMs < 0) return "0:00";
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="p-4 bg-muted/50">
      {/* Hidden AudioPlayer component that manages Web Audio API */}
      <AudioPlayer />

      <h3 className="text-sm font-semibold text-muted-foreground mb-3">
        Audio Player
      </h3>

      <div className="space-y-4">
        {/* Play controls and time display */}
        <div className="flex items-center gap-3">
          <PlayPauseButton />

          <div className="flex-1">
            {/* Progress bar */}
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${getProgress()}%` }}
              />
            </div>
          </div>

          <span className="text-sm font-mono text-muted-foreground min-w-[4rem] text-right">
            {getElapsedTime()}
          </span>
        </div>

        {/* Current playback time */}
        {isPlaying && currentDate && (
          <div className="text-xs text-muted-foreground text-center">
            Playing: {formatTime(currentDate, timeFormat)}
          </div>
        )}

        {/* Speed and Volume controls */}
        <div className="flex items-center gap-4">
          {/* Speed selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Speed</span>
            <Select
              value={playbackRate.toString()}
              onValueChange={handleSpeedChange}
            >
              <SelectTrigger className="w-[70px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEED_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value.toString()}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Volume slider */}
          <div className="flex items-center gap-2 flex-1">
            <Volume2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <Slider
              value={[volume]}
              onValueChange={handleVolumeChange}
              min={0}
              max={2}
              step={0.01}
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground min-w-[2.5rem] text-right">
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
