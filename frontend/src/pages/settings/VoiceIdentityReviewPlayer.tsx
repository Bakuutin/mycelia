import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Clock3,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import {
  WaveformPlayer,
  type WaveformPlayerHandle,
} from "@/components/audio/WaveformPlayer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { normalizeObjectId } from "@/lib/diarization";
import { useAudioPlaybackStore } from "@/stores/audioPlaybackStore";

export type VoiceIdentityDecision = "me" | "not-me" | "skip";
type ReviewCommand =
  | VoiceIdentityDecision
  | "play"
  | "previous"
  | "next"
  | "undo"
  | "edit"
  | { type: "profile"; index: number };

export type VoiceIdentityProfileOption = {
  id: string;
  name: string;
};

export interface VoiceIdentityReviewSegment {
  _id: unknown;
  original_id?: unknown;
  original?: unknown;
  runId?: string;
  embeddingSpaceId?: string;
  speaker?: string;
  start: Date | string;
  end: Date | string;
  speakerIdentity?: {
    primaryScore?: number;
    state?: string;
  };
}

interface VoiceIdentityReviewPlayerProps {
  segment: VoiceIdentityReviewSegment;
  profileName?: string;
  position: number;
  remaining: number;
  sessionAnswered: number;
  sessionTotal: number;
  pending: boolean;
  autoPlayNext: boolean;
  playOnMount: boolean;
  canPrevious: boolean;
  canNext: boolean;
  canUndo: boolean;
  canEdit: boolean;
  editingLabel?: string | null;
  alternateProfiles: VoiceIdentityProfileOption[];
  onDecision: (decision: VoiceIdentityDecision) => void;
  onAssignProfile: (profileId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onUndo: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onAutoPlayChange: (enabled: boolean) => void;
}

const SWIPE_DISTANCE_PX = 72;
const SWIPE_MAX_VERTICAL_PX = 48;

export function getReviewShortcut(key: string): ReviewCommand | null {
  if (/^[1-9]$/.test(key)) {
    return { type: "profile", index: Number(key) - 1 };
  }
  switch (key) {
    case " ":
    case "Spacebar":
      return "play";
    case "ArrowLeft":
      return "not-me";
    case "ArrowRight":
      return "me";
    case "ArrowUp":
      return "previous";
    case "ArrowDown":
      return "next";
    case "u":
    case "U":
      return "undo";
    case "s":
    case "S":
      return "skip";
    case "e":
    case "E":
      return "edit";
    default:
      return null;
  }
}

export function getSwipeDecision(
  start: { x: number; y: number },
  end: { x: number; y: number },
): VoiceIdentityDecision | null {
  const horizontal = end.x - start.x;
  const vertical = Math.abs(end.y - start.y);
  if (
    Math.abs(horizontal) < SWIPE_DISTANCE_PX ||
    vertical > SWIPE_MAX_VERTICAL_PX
  ) return null;
  return horizontal > 0 ? "me" : "not-me";
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest(
      "input, textarea, select, button, a, [contenteditable='true'], [role='switch']",
    ),
  );
}

function durationSeconds(segment: VoiceIdentityReviewSegment): number {
  const start = new Date(segment.start).getTime();
  const end = new Date(segment.end).getTime();
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, (end - start) / 1000)
    : 0;
}

function buildAudioUrl(segment: VoiceIdentityReviewSegment): string | null {
  const originalId = normalizeObjectId(segment.original_id ?? segment.original);
  const start = new Date(segment.start).getTime() / 1000;
  const end = new Date(segment.end).getTime() / 1000;
  if (!originalId || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return `/api/audio/wav?start=${encodeURIComponent(String(start))}&end=${
    encodeURIComponent(String(end))
  }&original_id=${encodeURIComponent(originalId)}`;
}

export function VoiceIdentityReviewPlayer({
  segment,
  profileName = "target profile",
  position,
  remaining,
  sessionAnswered,
  sessionTotal,
  pending,
  autoPlayNext,
  playOnMount,
  canPrevious,
  canNext,
  canUndo,
  canEdit,
  editingLabel,
  alternateProfiles,
  onDecision,
  onAssignProfile,
  onPrevious,
  onNext,
  onUndo,
  onEdit,
  onCancelEdit,
  onAutoPlayChange,
}: VoiceIdentityReviewPlayerProps) {
  const playerRef = useRef<WaveformPlayerHandle>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState(
    alternateProfiles[0]?.id ?? "",
  );
  const id = normalizeObjectId(segment._id);
  const duration = durationSeconds(segment);
  const audioUrl = buildAudioUrl(segment);
  const score = segment.speakerIdentity?.primaryScore;
  const hasScore = typeof score === "number" && Number.isFinite(score);
  const sessionPercent = sessionTotal > 0
    ? Math.min(100, Math.round((sessionAnswered / sessionTotal) * 100))
    : 0;
  const stopThen = (action: () => void) => {
    useAudioPlaybackStore.getState().stopActive();
    action();
  };

  useEffect(() => {
    if (
      !alternateProfiles.some((profile) => profile.id === selectedProfileId)
    ) {
      setSelectedProfileId(alternateProfiles[0]?.id ?? "");
    }
  }, [alternateProfiles, selectedProfileId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isInteractiveTarget(event.target) ||
        isInteractiveTarget(document.activeElement)
      ) return;
      const command = getReviewShortcut(event.key);
      if (!command) return;
      if (typeof command === "object") {
        if (pending) return;
        const profile = alternateProfiles[command.index];
        if (profile) {
          event.preventDefault();
          stopThen(() => onAssignProfile(profile.id));
        }
        return;
      }
      if (command === "play") {
        event.preventDefault();
        playerRef.current?.togglePlayback();
        return;
      }
      if (command === "edit" && canEdit) {
        event.preventDefault();
        stopThen(onEdit);
        return;
      }
      if (pending) return;
      if (command === "me" || command === "not-me" || command === "skip") {
        event.preventDefault();
        stopThen(() => onDecision(command));
      } else if (command === "previous" && canPrevious) {
        event.preventDefault();
        stopThen(onPrevious);
      } else if (command === "next" && canNext) {
        event.preventDefault();
        stopThen(onNext);
      } else if (command === "undo" && canUndo) {
        event.preventDefault();
        stopThen(onUndo);
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [
    canNext,
    canPrevious,
    canUndo,
    canEdit,
    alternateProfiles,
    onDecision,
    onAssignProfile,
    onEdit,
    onNext,
    onPrevious,
    onUndo,
    pending,
  ]);

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || pending || isInteractiveTarget(event.target)) return;
    const decision = getSwipeDecision(start, {
      x: event.clientX,
      y: event.clientY,
    });
    if (decision) stopThen(() => onDecision(decision));
  };

  return (
    <div
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
      data-testid="voice-review-card"
      onPointerDown={(event) => {
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={handlePointerUp}
    >
      <div className="border-b bg-gradient-to-r from-sky-500/10 via-background to-violet-500/10 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Segment {position} · {remaining} remaining
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {id
                ? (
                  <Link
                    className="font-medium text-primary hover:underline"
                    to={`/diarizations/${id}`}
                  >
                    {new Date(segment.start).toLocaleString()}
                  </Link>
                )
                : <span>{new Date(segment.start).toLocaleString()}</span>}
              <Badge variant="outline" className="gap-1 font-normal">
                <Clock3 className="h-3 w-3" />
                {duration.toFixed(1)} sec
              </Badge>
            </div>
          </div>
          <div className="text-right">
            {hasScore
              ? (
                <Badge className="text-sm">
                  Similarity to {profileName}: {Math.round(score * 100)}%
                </Badge>
              )
              : <Badge variant="secondary">Not classified</Badge>}
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {hasScore
                ? "Matcher similarity, not a calibrated probability."
                : "No identity matcher result exists for this segment yet."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          {audioUrl
            ? (
              <div className="rounded-lg border bg-muted/20 p-3">
                <WaveformPlayer
                  ref={playerRef}
                  key={id ?? audioUrl}
                  audioUrl={audioUrl}
                  duration={duration}
                  autoPlay={playOnMount}
                  ariaLabel="Play voice review segment"
                />
              </div>
            )
            : (
              <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                This segment has no valid source audio reference.
              </div>
            )}

          <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
            <Button
              size="lg"
              variant="outline"
              className="h-14 border-rose-500/40 text-base hover:bg-rose-500/10"
              disabled={pending}
              onClick={() => stopThen(() => onDecision("not-me"))}
            >
              <ArrowLeft className="mr-2 h-5 w-5" />Not Sky
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="h-14 px-4 text-muted-foreground"
              disabled={pending}
              onClick={() =>
                stopThen(() =>
                  editingLabel ? onCancelEdit() : onDecision("skip")
                )}
              title={editingLabel
                ? "Cancel correction"
                : "Keep this segment unlabeled and continue (S)"}
            >
              <SkipForward className="mr-1 h-4 w-4" />
              {editingLabel ? "Cancel" : "Skip"}
            </Button>
            <Button
              size="lg"
              className="h-14 bg-sky-600 text-base hover:bg-sky-700"
              disabled={pending}
              onClick={() => stopThen(() => onDecision("me"))}
            >
              Sky<ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>

          {alternateProfiles.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="sr-only" htmlFor="voice-review-other-profile">
                Assign another profile
              </label>
              <select
                id="voice-review-other-profile"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
              >
                {alternateProfiles.map((profile, index) => (
                  <option key={profile.id} value={profile.id}>
                    {index < 9 ? `${index + 1} · ` : ""}
                    {profile.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={pending || !selectedProfileId}
                onClick={() =>
                  stopThen(() => onAssignProfile(selectedProfileId))}
              >
                Assign profile
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Swipe or use ← Not Sky · → Sky · S skips · 1–9 profiles · Space
            plays · U undoes · E edits
          </p>
        </div>

        <aside className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">This session</span>
              <span>{sessionAnswered} / {sessionTotal}</span>
            </div>
            <Progress className="mt-2" value={sessionPercent} />
          </div>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-medium">Automatically play next</span>
              <span className="block text-xs text-muted-foreground">
                After a saved answer
              </span>
            </span>
            <Switch
              checked={autoPlayNext}
              onCheckedChange={onAutoPlayChange}
              aria-label="Automatically play next"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!canPrevious || pending}
              onClick={() => stopThen(onPrevious)}
              aria-label="Previous segment"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canUndo || pending}
              onClick={() => stopThen(onUndo)}
            >
              <RotateCcw className="mr-1 h-4 w-4" />Undo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!canNext || pending}
              onClick={() => stopThen(onNext)}
              aria-label="Next segment"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
