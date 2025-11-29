import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { callResource, apiClient } from "@/lib/api";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatTime } from "@/lib/formatTime";
import { SmartBackButton } from "@/components/SmartBackButton";
import { embeddingToColor } from "@/lib/pcaColor";
import { ObjectId } from "bson";
import { Play, Pause, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiarizationDoc {
  _id: unknown;
  inference_id?: unknown;
  original_id?: unknown;
  original?: unknown;
  start: Date;
  end: Date;
  speaker?: string;
  embedding?: number[];
  duration?: number;
  created_at?: Date;
}

const DiarizationDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { timeFormat } = useSettingsStore();
  const [diarization, setDiarization] = useState<DiarizationDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;

      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "findOne",
          collection: "diarizations",
          query: { _id: { $oid: id } },
        });

        if (result) {
          setDiarization(result);
        } else {
          setError("Diarization not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch diarization");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <SmartBackButton defaultPath="/transcript" />
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading diarization...</p>
        </div>
      </div>
    );
  }

  if (error || !diarization) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <SmartBackButton defaultPath="/transcript" />
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">{error || "Diarization not found"}</p>
        </div>
      </div>
    );
  }

  const color = embeddingToColor(diarization.embedding) || "#eab308";
  const duration = diarization.end.getTime() - diarization.start.getTime();
  const durationSeconds = Math.floor(duration / 1000);
  const durationMinutes = Math.floor(durationSeconds / 60);
  const durationSecondsRemainder = durationSeconds % 60;

  const loadAudio = async () => {
    if (!diarization || audioUrl) return;

    setAudioLoading(true);
    try {
      const originalId = diarization.original_id || diarization.original;
      const originalIdStr = originalId instanceof ObjectId
        ? originalId.toString()
        : String(originalId);

      const startParam = diarization.start.toISOString();
      const endParam = diarization.end.toISOString();

      const blob = await apiClient.getBlob(
        `/api/audio/wav?start=${encodeURIComponent(startParam)}&end=${encodeURIComponent(endParam)}&original_id=${encodeURIComponent(originalIdStr)}`
      );

      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      console.error("Failed to load audio:", err);
      setError(err instanceof Error ? err.message : "Failed to load audio");
    } finally {
      setAudioLoading(false);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current) {
      loadAudio().then(() => {
        setTimeout(() => {
          audioRef.current?.play();
          setIsPlaying(true);
        }, 100);
      });
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.load();
    }
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <SmartBackButton defaultPath="/transcript" />
        <h1 className="text-3xl font-bold">Diarization</h1>
      </div>

      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <div>
            <div className="font-semibold">Speaker Identity</div>
            <div className="text-sm text-muted-foreground">
              {diarization.speaker ? (
                <span className="font-mono">{diarization.speaker}</span>
              ) : (
                "Visual identifier for this voice"
              )}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t">
          <div className="text-sm font-medium text-muted-foreground mb-3">Audio Player</div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handlePlayPause}
              disabled={audioLoading}
              size="lg"
              className="flex-shrink-0"
            >
              {audioLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5" />
              )}
            </Button>
            <div className="flex-1">
              <audio
                ref={audioRef}
                src={audioUrl || undefined}
                className="w-full"
                controls
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
            </div>
          </div>
          {!audioUrl && !audioLoading && (
            <p className="text-xs text-muted-foreground mt-2">
              Click play to load and play this diarized segment
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Start Time</div>
            <div className="text-lg">{formatTime(diarization.start, timeFormat)}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">End Time</div>
            <div className="text-lg">{formatTime(diarization.end, timeFormat)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Duration</div>
            <div className="text-lg">
              {durationMinutes > 0
                ? `${durationMinutes}m ${durationSecondsRemainder}s`
                : `${durationSecondsRemainder}s`}
            </div>
            {diarization.duration && (
              <div className="text-xs text-muted-foreground mt-1">
                Stored: {diarization.duration.toFixed(2)}s
              </div>
            )}
          </div>
          {diarization.created_at && (
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Processed At</div>
              <div className="text-lg">{formatTime(diarization.created_at, timeFormat)}</div>
            </div>
          )}
        </div>

        <div className="pt-4 border-t">
          <div className="text-sm font-medium text-muted-foreground mb-1">Segment ID</div>
          <div className="text-sm font-mono break-all">
            {diarization._id instanceof ObjectId
              ? diarization._id.toString()
              : String(diarization._id)}
          </div>
        </div>

        {diarization.inference_id != null && (
          <div className="pt-4 border-t">
            <div className="text-sm font-medium text-muted-foreground mb-1">Inference ID</div>
            <div className="text-sm font-mono break-all">
              {diarization.inference_id instanceof ObjectId
                ? diarization.inference_id.toString()
                : String(diarization.inference_id)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Groups segments from the same diarization run
            </div>
          </div>
        )}

        <div className="pt-4 border-t">
          <div className="text-sm font-medium text-muted-foreground mb-1">Original Audio</div>
          <div className="text-sm font-mono break-all">
            {(() => {
              const original = diarization.original_id || diarization.original;
              return original instanceof ObjectId
                ? original.toString()
                : String(original);
            })()}
          </div>
        </div>

        {diarization.embedding && (
          <div className="pt-4 border-t">
            <div className="text-sm font-medium text-muted-foreground mb-2">
              Embedding Vector
            </div>
            <div className="space-y-2">
              <div className="text-sm">
                <span className="font-medium">{diarization.embedding.length}</span> dimensions
                <span className="text-xs text-muted-foreground ml-2">
                  (normalized to [-1, 1])
                </span>
              </div>
              {diarization.embedding.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>
                    Range: [{Math.min(...diarization.embedding).toFixed(4)},{" "}
                    {Math.max(...diarization.embedding).toFixed(4)}]
                  </div>
                  <div>
                    Mean:{" "}
                    {(
                      diarization.embedding.reduce((a, b) => a + b, 0) /
                      diarization.embedding.length
                    ).toFixed(4)}
                  </div>
                  <div>
                    L2 Norm:{" "}
                    {Math.sqrt(
                      diarization.embedding.reduce((sum, val) => sum + val * val, 0)
                    ).toFixed(4)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiarizationDetailPage;

