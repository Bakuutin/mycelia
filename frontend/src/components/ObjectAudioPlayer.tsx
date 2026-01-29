import { useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Volume2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlayPauseButton } from "@/modules/audio/PlayPauseButton";
import { useAudioPlayer } from "@/modules/audio/player";
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
  const { currentDate, resetDate, isPlaying, setIsPlaying } = useAudioPlayer();
  const { volume, setVolume, playbackRate, setPlaybackRate, timeFormat } = useSettingsStore();
  const prevStartTimeRef = useRef<number | null>(null);

  const startDate = typeof timeRange.start === "string"
    ? new Date(timeRange.start)
    : timeRange.start;

  const endDate = timeRange.end
    ? (typeof timeRange.end === "string" ? new Date(timeRange.end) : timeRange.end)
    : null;

  // Initialize player to start of time range when mounted or when startDate changes
  // This fixes the issue where navigating between objects with cached data
  // wouldn't reset the player because the component stayed mounted
  useEffect(() => {
    const startTime = startDate.getTime();
    if (prevStartTimeRef.current !== startTime) {
      resetDate(startDate);
      prevStartTimeRef.current = startTime;
    }
  }, [startDate, resetDate]);

  // Stop playback when currentDate exceeds endDate
  useEffect(() => {
    if (!isPlaying || !currentDate || !endDate) return;
    
    if (currentDate.getTime() >= endDate.getTime()) {
      setIsPlaying(false);
      // Reset to end position so progress bar shows 100%
      resetDate(endDate);
    }
  }, [currentDate, endDate, isPlaying, setIsPlaying, resetDate]);

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

  // Get total duration formatted
  const getTotalDuration = () => {
    if (!startDate || !endDate) return "";
    const durationMs = endDate.getTime() - startDate.getTime();
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Handle progress bar click to seek
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const duration = (endDate?.getTime() || startDate.getTime() + 3600000) - startDate.getTime();
    const targetTime = new Date(startDate.getTime() + duration * percentage);
    resetDate(targetTime);
  };

  return (
    <div className="border rounded-lg p-4 bg-gradient-to-r from-muted/50 to-muted/30">
      <div className="flex flex-wrap items-center gap-4">
        {/* Play button */}
        <PlayPauseButton />

        {/* Progress bar section */}
        <div className="flex-1 min-w-[200px]">
          <div
            className="h-2 bg-background rounded-full overflow-hidden cursor-pointer hover:h-3 transition-all"
            onClick={handleProgressClick}
            title="Click to seek"
          >
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${getProgress()}%` }}
            />
          </div>
        </div>

        {/* Time display */}
        <div className="flex flex-col items-end">
          <span className="text-sm font-mono font-medium">
            {getElapsedTime()} / {getTotalDuration()}
          </span>
          <span className="text-xs text-muted-foreground">
            {currentDate ? formatTime(currentDate, timeFormat) : "Ready"}
          </span>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-border hidden sm:block" />

        {/* Speed selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Speed</span>
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
        <div className="flex items-center gap-2 min-w-[120px]">
          <Volume2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Slider
            value={[volume]}
            onValueChange={handleVolumeChange}
            min={0}
            max={2}
            step={0.01}
            className="flex-1"
          />
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-border hidden sm:block" />

        {/* View in Timeline button */}
        <Button
          variant="outline"
          size="sm"
          asChild
          className="h-8 text-xs"
        >
          <Link to={`/timeline?start=${startDate.getTime()}${endDate ? `&end=${endDate.getTime()}` : ''}`}>
            <Calendar className="w-3.5 h-3.5 mr-1.5" />
            View in Timeline
          </Link>
        </Button>
      </div>
    </div>
  );
}
