import { Link } from "react-router-dom";
import {
  AudioWaveform,
  ExternalLink,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAudioPlayer } from "@/modules/audio/player";
import { useSettingsStore } from "@/stores/settingsStore";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function formatPlaybackDate(date: Date | null): string {
  if (!date) return "Choose a time from Timeline or a transcript.";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPlaybackTime(date: Date | null): string {
  if (!date) return "--:--:--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function GlobalAudioPlayerPopover() {
  const {
    chunks,
    currentDate,
    isCreatingSource,
    isPlaying,
    resetDate,
    toggleIsPlaying,
  } = useAudioPlayer();
  const { playbackRate, setPlaybackRate, setVolume, volume } =
    useSettingsStore();

  const hasPlaybackPosition = currentDate !== null;
  const isBuffering = isPlaying && (isCreatingSource || chunks.length === 0);
  const status = !hasPlaybackPosition
    ? "Ready"
    : isBuffering
    ? "Buffering"
    : isPlaying
    ? "Playing"
    : "Paused";

  const seekBy = (seconds: number) => {
    if (!currentDate) return;
    resetDate(new Date(currentDate.getTime() + seconds * 1000));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Open audio player${
            hasPlaybackPosition ? `, ${status.toLowerCase()}` : ""
          }`}
          data-testid="global-player-trigger"
        >
          <AudioWaveform
            className={isPlaying ? "text-primary" : "text-muted-foreground"}
            size={20}
          />
          {hasPlaybackPosition && (
            <span
              className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-background ${
                isPlaying ? "animate-pulse bg-green-500" : "bg-amber-500"
              }`}
            />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Now playing</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {formatPlaybackDate(currentDate)}
            </p>
          </div>
          <Badge
            variant={isPlaying ? "default" : "secondary"}
            className="shrink-0"
          >
            {status}
          </Badge>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 text-center">
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {formatPlaybackTime(currentDate)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Timeline position
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => seekBy(-15)}
            disabled={!hasPlaybackPosition}
            aria-label="Back 15 seconds"
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            15s
          </Button>
          <Button
            size="icon"
            className="h-11 w-11 rounded-full"
            onClick={toggleIsPlaying}
            disabled={!hasPlaybackPosition}
            aria-label={isPlaying ? "Pause audio" : "Resume audio"}
          >
            {isPlaying
              ? <Pause className="h-5 w-5" />
              : <Play className="ml-0.5 h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => seekBy(15)}
            disabled={!hasPlaybackPosition}
            aria-label="Forward 15 seconds"
          >
            15s
            <RotateCw className="ml-1 h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setVolume(volume === 0 ? 1 : 0)}
              aria-label={volume === 0 ? "Unmute audio" : "Mute audio"}
            >
              {volume === 0
                ? <VolumeX className="h-4 w-4" />
                : <Volume2 className="h-4 w-4" />}
            </Button>
            <Slider
              value={[volume]}
              onValueChange={([nextVolume]) => setVolume(nextVolume)}
              min={0}
              max={3}
              step={0.05}
              aria-label="Playback volume"
            />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(volume * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Gauge className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Speed</span>
            <Select
              value={String(playbackRate)}
              onValueChange={(value) => setPlaybackRate(Number(value))}
            >
              <SelectTrigger className="ml-auto h-8 w-24">
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

        <Button variant="outline" size="sm" className="w-full" asChild>
          <Link to="/audio">
            Open full player
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>

        <p className="text-center text-[11px] text-muted-foreground">
          Space toggles playback from any page unless you are typing.
        </p>
      </PopoverContent>
    </Popover>
  );
}
