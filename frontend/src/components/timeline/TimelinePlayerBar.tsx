import { memo, useEffect } from "react";
import type { ZoomTransform } from "d3-zoom";
import type { ScaleTime } from "d3-scale";
import { Pause, Play, Volume2, VolumeX, Navigation, Radio, X } from "lucide-react";
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
  scale: ScaleTime<number, number>;
  transform: ZoomTransform;
  width: number;
  className?: string;
}

/**
 * TimelinePlayerBar - Waveform scrubber + player controls below the timeline.
 */
export const TimelinePlayerBar = memo(function TimelinePlayerBar({
  scale,
  transform,
  width,
  className,
}: TimelinePlayerBarProps) {
  const { isPlaying, toggleIsPlaying, currentDate, originalId, setOriginalId } = useAudioPlayer();
  const { volume, setVolume, playbackRate, setPlaybackRate, followPlayback, setFollowPlayback } = useSettingsStore();

  const isMuted = volume === 0;

  // Space to play/pause
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [toggleIsPlaying]);

  return (
    <div className={cn("border rounded-lg bg-card overflow-hidden", className)}>
      {/* Waveform scrubber */}
      <TimelineAudioScrubber
        scale={scale}
        transform={transform}
        width={width}
        height={48}
      />

      {/* Controls bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t bg-muted/30">
        {/* Play/Pause */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleIsPlaying()}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{isPlaying ? "Pause" : "Play"} (Space)</p></TooltipContent>
        </Tooltip>

        {/* Current Time */}
        <div className="flex flex-col items-start min-w-[100px]">
          <span className="text-sm font-mono font-medium">{formatTime(currentDate)}</span>
          <span className="text-[10px] text-muted-foreground">{formatDate(currentDate)}</span>
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Volume */}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setVolume(isMuted ? 1 : 0)}>
                {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{isMuted ? "Unmute" : "Mute"}</p></TooltipContent>
          </Tooltip>
          <Slider value={[volume]} onValueChange={([v]) => setVolume(v)} min={0} max={2} step={0.05} className="w-20" />
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Speed */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Speed</span>
          <Select value={String(playbackRate)} onValueChange={(v) => setPlaybackRate(parseFloat(v))}>
            <SelectTrigger className="h-7 w-[60px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAYBACK_RATES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>{rate}x</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active audio source indicator */}
        {originalId && (
          <>
            <div className="h-6 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setOriginalId(null)}
                >
                  <Radio className="h-3 w-3 text-primary" />
                  <span className="max-w-[80px] truncate">Source: {originalId.slice(-6)}</span>
                  <X className="h-3 w-3 opacity-50" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Click to play all sources (currently filtered)</p></TooltipContent>
            </Tooltip>
          </>
        )}

        <div className="flex-1" />

        {/* Follow Playback */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={followPlayback ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setFollowPlayback(!followPlayback)}
            >
              <Navigation className={cn("h-3.5 w-3.5", followPlayback && "text-primary")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{followPlayback ? "Following playhead" : "Follow playhead"}</p></TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

export default TimelinePlayerBar;
