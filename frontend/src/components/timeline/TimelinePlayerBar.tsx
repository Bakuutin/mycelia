import { memo, useEffect } from "react";
import type { ZoomTransform } from "d3-zoom";
import type { ScaleTime } from "d3-scale";
import { Pause, Play, Volume2, VolumeX, Maximize2, Focus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAudioPlayer } from "@/modules/audio/player";
import { useSettingsStore } from "@/stores/settingsStore";
import { TimelineAudioScrubber } from "./TimelineAudioScrubber";
import { cn } from "@/lib/utils";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(date: Date | null): string {
  if (!date) return "--:--:--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface TimelinePlayerBarProps {
  /** D3 time scale */
  scale: ScaleTime<number, number>;
  /** D3 zoom transform */
  transform: ZoomTransform;
  /** Width of the container in pixels */
  width: number;
  className?: string;
}

/**
 * TimelinePlayerBar - Combined audio scrubber with waveform and player controls.
 * Positioned below the timeline tracks.
 */
export const TimelinePlayerBar = memo(function TimelinePlayerBar({
  scale,
  transform,
  width,
  className,
}: TimelinePlayerBarProps) {
  const { isPlaying, toggleIsPlaying, currentDate } = useAudioPlayer();
  const { volume, setVolume, playbackRate, setPlaybackRate, waveformScope, setWaveformScope } = useSettingsStore();

  const isMuted = volume === 0;
  const showFullWaveform = waveformScope === "full";

  // Keyboard shortcut for play/pause (Space)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        toggleIsPlaying();
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleIsPlaying]);

  return (
    <div className={cn("border rounded-lg bg-card overflow-hidden", className)}>
      {/* Waveform scrubber */}
      <TimelineAudioScrubber
        scale={scale}
        transform={transform}
        width={width}
        height={56}
        showFullWaveform={showFullWaveform}
        playheadWindowMinutes={5}
      />

      {/* Controls bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-t bg-muted/30">
        {/* Play/Pause Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => toggleIsPlaying()}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isPlaying ? "Pause" : "Play"} (Space)</p>
          </TooltipContent>
        </Tooltip>

        {/* Current Time Display */}
        <div className="flex flex-col items-start min-w-[100px]">
          <span className="text-sm font-mono font-medium">
            {formatTime(currentDate)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatDate(currentDate)}
          </span>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Volume Control */}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setVolume(isMuted ? 1 : 0)}
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMuted ? "Unmute" : "Mute"}</p>
            </TooltipContent>
          </Tooltip>
          <Slider
            value={[volume]}
            onValueChange={([v]) => setVolume(v)}
            min={0}
            max={2}
            step={0.05}
            className="w-20"
          />
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Playback Speed */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Speed:</span>
          <Select
            value={String(playbackRate)}
            onValueChange={(v) => setPlaybackRate(parseFloat(v))}
          >
            <SelectTrigger className="h-8 w-[70px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAYBACK_RATES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {rate}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Waveform Scope Toggle */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showFullWaveform ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setWaveformScope("full")}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Full range waveform</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={!showFullWaveform ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setWaveformScope("playhead")}
              >
                <Focus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Around playhead (+/- 5 min)</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
});

export default TimelinePlayerBar;
