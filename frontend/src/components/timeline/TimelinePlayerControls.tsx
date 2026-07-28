import { LocateFixed, Pause, Play, Volume2, VolumeX } from "lucide-react";
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

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface TimelinePlayerControlsProps {
  onGoToAudio: (date: Date) => void;
}

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

export function TimelinePlayerControls({
  onGoToAudio,
}: TimelinePlayerControlsProps) {
  const { isPlaying, toggleIsPlaying, currentDate } = useAudioPlayer();
  const { volume, setVolume, playbackRate, setPlaybackRate } =
    useSettingsStore();

  const isMuted = volume === 0;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg border">
      {/* Play/Pause Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => toggleIsPlaying()}
          >
            {isPlaying
              ? <Pause className="h-4 w-4" />
              : <Play className="h-4 w-4" />}
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => currentDate && onGoToAudio(currentDate)}
            disabled={!currentDate}
            aria-label="Go to current audio position"
          >
            <LocateFixed className="mr-1.5 h-4 w-4" />
            Go to audio
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Center the timeline on the current audio position</p>
        </TooltipContent>
      </Tooltip>

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
              {isMuted
                ? <VolumeX className="h-4 w-4" />
                : <Volume2 className="h-4 w-4" />}
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
    </div>
  );
}
