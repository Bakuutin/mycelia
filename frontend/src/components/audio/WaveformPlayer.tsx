import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import { useAudioPlaybackStore } from "@/stores/audioPlaybackStore";

interface WaveformPlayerProps {
  audioUrl: string;
  duration?: number;
  className?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  ariaLabel?: string;
}

export interface WaveformPlayerHandle {
  play: () => Promise<void>;
  pause: () => void;
  togglePlayback: () => void;
}

export const WaveformPlayer = forwardRef<
  WaveformPlayerHandle,
  WaveformPlayerProps
>(function WaveformPlayer(
  {
    audioUrl,
    duration: initialDuration,
    className,
    autoPlay = false,
    onEnded,
    ariaLabel = "Play audio segment",
  },
  ref,
) {
  const playbackId = useId();
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const playAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    useAudioPlaybackStore.getState().acquire(
      playbackId,
      () => audio.pause(),
    );
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
      useAudioPlaybackStore.getState().release(playbackId);
    }
  }, [playbackId]);

  const pauseAudio = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const togglePlayback = useCallback(() => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      void playAudio();
    } else {
      pauseAudio();
    }
  }, [pauseAudio, playAudio]);

  useImperativeHandle(ref, () => ({
    play: playAudio,
    pause: pauseAudio,
    togglePlayback,
  }), [pauseAudio, playAudio, togglePlayback]);

  // Load audio and extract waveform data
  useEffect(() => {
    const loadAudio = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch audio with auth headers
        const response = await apiClient.fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();

        // Create a blob URL for the Audio element
        const blob = new Blob([arrayBuffer], {
          type: response.headers.get("content-type") || "audio/wav",
        });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;

        // Create audio element for playback using blob URL
        const audio = new Audio(blobUrl);
        audioRef.current = audio;

        audio.addEventListener("loadedmetadata", () => {
          setDuration(audio.duration);
        });

        audio.addEventListener("ended", () => {
          setIsPlaying(false);
          setCurrentTime(0);
          useAudioPlaybackStore.getState().release(playbackId);
          onEndedRef.current?.();
        });
        audio.addEventListener("play", () => setIsPlaying(true));
        audio.addEventListener("pause", () => {
          setIsPlaying(false);
          useAudioPlaybackStore.getState().release(playbackId);
        });

        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Extract waveform peaks
        const channelData = audioBuffer.getChannelData(0);
        const samples = 100; // Number of bars in waveform
        const blockSize = Math.floor(channelData.length / samples);
        const peaks: number[] = [];

        for (let i = 0; i < samples; i++) {
          const start = blockSize * i;
          let max = 0;
          for (let j = 0; j < blockSize; j++) {
            const abs = Math.abs(channelData[start + j]);
            if (abs > max) max = abs;
          }
          peaks.push(max);
        }

        // Normalize peaks
        const maxPeak = Math.max(...peaks);
        const normalizedPeaks = peaks.map((p) => p / maxPeak);

        setWaveformData(normalizedPeaks);
        setDuration(audioBuffer.duration);
        setIsLoading(false);

        await audioContext.close();
      } catch (err) {
        console.error("Error loading audio:", err);
        setError("Failed to load audio");
        setIsLoading(false);
      }
    };

    loadAudio();

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      useAudioPlaybackStore.getState().release(playbackId);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioUrl, playbackId]);

  useEffect(() => {
    if (!isLoading && autoPlay) {
      void playAudio();
    }
  }, [autoPlay, isLoading, playAudio]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barWidth = width / waveformData.length;
    const progressRatio = duration > 0 ? currentTime / duration : 0;
    const progressX = progressRatio * width;

    ctx.clearRect(0, 0, width, height);

    // Draw bars
    waveformData.forEach((peak, i) => {
      const x = i * barWidth;
      const barHeight = Math.max(2, peak * (height - 4));
      const y = (height - barHeight) / 2;

      // Use different colors for played vs unplayed
      if (x < progressX) {
        ctx.fillStyle = "hsl(var(--primary))";
      } else {
        ctx.fillStyle = "hsl(var(--muted-foreground) / 0.3)";
      }

      ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
    });

    // Draw playhead
    if (isPlaying || currentTime > 0) {
      ctx.fillStyle = "hsl(var(--primary))";
      ctx.fillRect(progressX - 1, 0, 2, height);
    }
  }, [waveformData, currentTime, duration, isPlaying]);

  // Update time during playback
  const updateTime = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (isPlaying) {
        animationRef.current = requestAnimationFrame(updateTime);
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateTime);
    } else if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, updateTime]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const newTime = ratio * duration;

    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 p-2 text-sm text-destructive",
          className,
        )}
      >
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={togglePlayback}
        disabled={isLoading}
        aria-label={isPlaying ? `Pause ${ariaLabel}` : ariaLabel}
      >
        {isLoading
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : isPlaying
          ? <Pause className="h-4 w-4" />
          : <Play className="h-4 w-4" />}
      </Button>

      <div className="flex-1 min-w-0">
        <canvas
          ref={canvasRef}
          className="w-full h-8 cursor-pointer rounded"
          onClick={handleCanvasClick}
        />
      </div>

      <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
});

export default WaveformPlayer;
