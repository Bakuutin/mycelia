import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useJobsListener } from "@/hooks/useJobsListener";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Copy,
  PauseCircle,
  Play,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { JobInfo } from "@/types/jobs";
import { parseJobError } from "@/lib/jobs";
import { formatJobDuration } from "@/lib/jobDuration";

type WorkerStatus = {
  workers: Record<string, { paused: boolean }>;
};

type ExternalServiceHealth = {
  id: "stt" | "llm";
  label: string;
  status: "healthy" | "loading" | "unavailable" | "misconfigured";
  configured: boolean;
  baseUrl?: string;
  modelsUrl?: string;
  source?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  model?: string;
  models?: string[];
  httpStatus?: number;
  latencyMs?: number;
  message: string;
  checkedAt: string;
  usedBy: string[];
};

type PipelineBacklog = {
  ready: number;
  retryableErrors?: number;
  processing?: number;
  missingTotal?: number;
  blockedWithoutTranscripts?: number;
  failedJobsUnretried: number;
};

type PipelineHealth = {
  checkedAt: string;
  services: ExternalServiceHealth[];
  backlogs: Record<
    "transcription" | "conversation_extractor" | "summarization",
    PipelineBacklog
  >;
  recovery: {
    startupChecks: boolean;
    periodicRetrySeconds: number;
    note: string;
  };
};

type ModelAlias = "small" | "medium" | "large";
type LlmProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  aliases: Record<ModelAlias, string>;
  defaultAlias: ModelAlias;
};
type InferenceRoutingConfig = {
  llmProfiles?: {
    activeProfileId: string;
    profiles: LlmProfile[];
  } | null;
  transcription?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  } | null;
};

type VadJobFormData = {
  limit: number;
  batchSize: number;
  originalId?: string;
  start?: Date;
  end?: Date;
};

/**
 * Worker pipeline configuration with display order and descriptions.
 * Used for displaying workers in logical pipeline order in the UI.
 */
const WORKER_PIPELINE = [
  {
    type: "ingestion",
    order: 1,
    description: "Processes audio files into chunks",
  },
  {
    type: "vad",
    order: 2,
    description: "Voice Activity Detection on audio chunks",
  },
  {
    type: "transcription_sequence_creator",
    order: 3,
    description: "Groups speech chunks into sequences",
  },
  {
    type: "transcription",
    order: 4,
    description: "Transcribes sequences to text using LLM",
  },
  {
    type: "conversation_chunk_creator",
    order: 5,
    description: "Groups transcriptions into conversation chunks",
  },
  {
    type: "conversation_extractor",
    order: 6,
    description: "Extracts conversations and entities using LLM",
  },
  {
    type: "summarization",
    order: 7,
    description: "Generates summaries for conversations",
  },
  {
    type: "diarization",
    order: 8,
    description: "Speaker identification/diarization",
  },
  {
    type: "histRecalculation",
    order: 9,
    description: "Recalculates timeline histograms",
  },
] as const;

const CRITICAL_PIPELINE_WORKERS = new Set([
  "vad",
  "transcription_sequence_creator",
  "transcription",
  "conversation_chunk_creator",
  "conversation_extractor",
  "summarization",
]);

/** Status priority for sorting - lower number = higher priority (shown first) */
const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  waiting: 1,
  failed: 2,
  delayed: 3,
  completed: 4,
};

/**
 * Determines if a completed job produced no meaningful output.
 * Different job types have different "empty" indicators.
 */
function isEmptyJobResult(job: JobInfo): boolean {
  if (job.state !== "completed") return false;

  const progress = job.progress || {};
  const result = job.result || {};

  switch (job.type) {
    case "vad":
      return (
        (progress.hasSpeech === 0 || result.hasSpeech === 0) &&
        (progress.processed === 0 || result.processed === 0)
      );
    case "conversation_chunk_creator":
      return (
        (result.finalized ?? 0) === 0 &&
        (result.streamed ?? 0) === 0 &&
        (result.chunksCreated ?? 0) === 0
      );
    case "conversation_extractor":
      return (
        (result.conversationsCreated ?? 0) === 0 &&
        (result.chunksProcessed ?? 0) === 0
      );
    case "transcription_sequence_creator":
      return (result.processed ?? 0) === 0;
    case "transcription":
      if (result.result === "empty") return true;
      if (result.wordCount != null && result.wordCount === 0) return true;
      // No sequence was processed (processed: 0 with no transcriptionId)
      if (result.processed === 0 && !result.transcriptionId) return true;
      if (result.wordCount != null && result.wordCount > 0) return false;
      return false;
    default: {
      const processed = progress.processed ?? result.processed ?? -1;
      const total = progress.total ?? result.total ?? -1;
      return processed === 0 && total === 0;
    }
  }
}

/**
 * Renders a date range link to the timeline from job data start/end fields.
 */
function JobDateRange({ job }: { job: JobInfo }) {
  const start = job.data?.start ? new Date(job.data.start) : null;
  const end = job.data?.end ? new Date(job.data.end) : null;
  if (!start) return null;
  const endTs = end ? end.getTime() : start.getTime() + 86400000;
  const isSameDay = end && start.toDateString() === end.toDateString();
  return (
    <Link
      to={`/timeline?start=${start.getTime()}&end=${endTs}`}
      className="text-xs text-primary hover:underline"
    >
      {isSameDay
        ? `${format(start, "MMM d, HH:mm")}–${format(end, "HH:mm")}`
        : end
        ? `${format(start, "MMM d, HH:mm")} — ${format(end, "MMM d, HH:mm")}`
        : `from ${format(start, "MMM d, HH:mm")}`}
    </Link>
  );
}

/**
 * Renders the Progress column content for a job row.
 * Handles all job types with type-specific displays.
 */
function JobProgressCell({ job }: { job: JobInfo }) {
  const result = job.result || {};
  const progress = job.progress || {};
  // Treat as completed if state is completed, OR if active but result already populated
  const hasResult = job.result && typeof job.result === "object" &&
    Object.keys(job.result).length > 0;
  const isCompleted = job.state === "completed" ||
    (job.state === "active" && hasResult);
  const isActive = job.state === "active" && !hasResult;

  // --- Failed jobs: show parsed error ---
  if (job.state === "failed" && job.failedReason) {
    const error = parseJobError(job.failedReason);
    if (error) {
      return (
        <div className="space-y-1">
          <Badge
            variant="secondary"
            className="bg-red-500/10 text-red-500 text-xs"
          >
            {error.label}
          </Badge>
          <div
            className="text-xs text-red-400/80 truncate max-w-[250px]"
            title={error.detail}
          >
            {error.detail}
          </div>
        </div>
      );
    }
  }

  // --- Transcription ---
  if (job.type === "transcription") {
    if (isCompleted) {
      const isEmpty = result.result === "empty" ||
        (result.wordCount != null && result.wordCount === 0) ||
        (result.processed === 0 && !result.transcriptionId);
      if (isEmpty) {
        // Use sequenceStart from result, progress, or fall back to job creation time
        const seqStart = result.sequenceStart || progress.sequenceStart ||
          (job.timestamp ? new Date(job.timestamp).toISOString() : null);
        return (
          <div className="space-y-1">
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-500 text-xs"
            >
              Empty
            </Badge>
            {seqStart && (
              <Link
                to={`/timeline?start=${new Date(seqStart).getTime()}&end=${
                  new Date(seqStart).getTime() +
                  (result.audioDuration || 60) * 1000 + 60000
                }`}
                className="text-xs text-primary hover:underline"
              >
                {format(new Date(seqStart), "MMM d, HH:mm")}
              </Link>
            )}
          </div>
        );
      }
      return (
        <div className="space-y-1">
          {result.sequenceStart && (
            <Link
              to={`/timeline?start=${
                new Date(result.sequenceStart).getTime()
              }&end=${
                new Date(result.sequenceStart).getTime() +
                (result.audioDuration || 60) * 1000 + 60000
              }`}
              className="text-xs text-primary hover:underline"
            >
              {format(new Date(result.sequenceStart), "MMM d, HH:mm")}
            </Link>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.audioDuration != null && (
              <span>{result.audioDuration.toFixed(1)}s</span>
            )}
            {result.wordCount != null
              ? <span>{result.wordCount} words</span>
              : <span className="opacity-50">— words</span>}
            {result.segmentCount != null && (
              <span>{result.segmentCount} segments</span>
            )}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
          {result.textPreview && (
            <div
              className="text-xs text-muted-foreground/70 truncate max-w-[250px]"
              title={result.textPreview}
            >
              {result.textPreview}
            </div>
          )}
        </div>
      );
    }
    if (progress.stage) {
      const stageLabels: Record<string, string> = {
        processing: "Processing",
        fetching_chunks: "Fetching chunks",
        combining_audio: "Combining audio",
        transcribing: "Transcribing",
        saving_result: "Saving",
        empty_result: "Empty result",
        completed: "Finishing",
      };
      return (
        <div className="space-y-1">
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-500 text-xs"
          >
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          {progress.sequenceStart && (
            <Link
              to={`/timeline?start=${
                new Date(progress.sequenceStart).getTime()
              }&end=${new Date(progress.sequenceStart).getTime() + 120000}`}
              className="text-xs text-primary hover:underline"
            >
              {format(new Date(progress.sequenceStart), "MMM d, HH:mm")}
            </Link>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.chunkCount != null && (
              <span>{progress.chunkCount} chunks</span>
            )}
            {progress.audioSize != null && (
              <span>{(progress.audioSize / 1024).toFixed(0)} KB</span>
            )}
            {progress.duration != null && (
              <span>{progress.duration.toFixed(1)}s audio</span>
            )}
          </div>
        </div>
      );
    }
  }

  // --- VAD ---
  if (job.type === "vad") {
    if (isCompleted) {
      if ((result.hasSpeech ?? 0) === 0 && (result.processed ?? 0) === 0) {
        return (
          <Badge
            variant="secondary"
            className="bg-amber-500/10 text-amber-500 text-xs"
          >
            Empty
          </Badge>
        );
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.processed != null && result.total != null && (
              <span>{result.processed}/{result.total} processed</span>
            )}
            {result.hasSpeech != null && (
              <span>{result.hasSpeech} with speech</span>
            )}
            {result.duration != null && (
              <span>{result.duration.toFixed(1)}s</span>
            )}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (isActive && progress) {
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.processed != null && progress.total != null && (
              <span>{progress.processed}/{progress.total} processed</span>
            )}
            {progress.hasSpeech != null && (
              <span>{progress.hasSpeech} with speech</span>
            )}
          </div>
          {progress.currentTimestamp && (
            <div className="text-xs text-muted-foreground/70">
              at {format(new Date(progress.currentTimestamp), "MMM d, HH:mm")}
            </div>
          )}
        </div>
      );
    }
  }

  // --- Conversation Chunk Creator ---
  if (job.type === "conversation_chunk_creator") {
    if (isCompleted) {
      if (
        (result.finalized ?? 0) === 0 && (result.streamed ?? 0) === 0 &&
        (result.chunksCreated ?? 0) === 0
      ) {
        return (
          <Badge
            variant="secondary"
            className="bg-amber-500/10 text-amber-500 text-xs"
          >
            Empty
          </Badge>
        );
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.chunksCreated != null && (
              <span>{result.chunksCreated} chunks</span>
            )}
            {result.finalized != null && (
              <span>{result.finalized} finalized</span>
            )}
            {result.streamed != null && result.streamed > 0 && (
              <span>{result.streamed} streamed</span>
            )}
            {result.backfilled != null && result.backfilled > 0 && (
              <span>{result.backfilled} backfilled</span>
            )}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (isActive && progress.stage) {
      const stageLabels: Record<string, string> = {
        finalizing_stale: "Finalizing",
        streaming: "Streaming",
        backfilling: "Backfilling",
      };
      return (
        <div className="space-y-1">
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-500 text-xs"
          >
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.finalized != null && (
              <span>{progress.finalized} finalized</span>
            )}
            {progress.streamed != null && (
              <span>{progress.streamed} streamed</span>
            )}
          </div>
        </div>
      );
    }
  }

  // --- Conversation Extractor ---
  if (job.type === "conversation_extractor") {
    if (isCompleted) {
      if (
        (result.conversationsCreated ?? 0) === 0 &&
        (result.chunksProcessed ?? 0) === 0
      ) {
        return (
          <Badge
            variant="secondary"
            className="bg-muted text-muted-foreground text-xs"
            title="No conversation chunks were ready to process"
          >
            Idling
          </Badge>
        );
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          {result.description && (
            <div
              className="max-w-xl truncate text-xs text-foreground"
              title={result.description}
            >
              {result.description}
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.conversationsCreated != null && (
              <span>{result.conversationsCreated} conversations</span>
            )}
            {result.chunksProcessed != null && (
              <span>{result.chunksProcessed} chunks</span>
            )}
            {result.segmentsFound != null
              ? (
                <>
                  <span>{result.segmentsFound} segments</span>
                  <span>{result.emojiCount ?? 0} emoji</span>
                  <span>{result.entityCount ?? 0} entities</span>
                  <span>
                    {result.relationshipsCreated ?? 0}/
                    {result.relationshipsAttempted ?? 0} links
                  </span>
                  <span>{result.agreementCount ?? 0} agreements</span>
                  <span
                    className={(result.relationshipErrors ?? 0) > 0
                      ? "text-red-400"
                      : undefined}
                  >
                    {result.relationshipErrors ?? 0} link errors
                  </span>
                </>
              )
              : <span>legacy result: extraction counts unavailable</span>}
            {result.errors?.length > 0 && (
              <span className="text-red-400">
                {result.errors.length} errors
              </span>
            )}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (progress.stage) {
      const stageLabels: Record<string, string> = {
        processing_chunk: "Processing chunk",
        segmenting: "Segmenting",
        extracting_metadata: "Extracting metadata",
      };
      return (
        <div className="space-y-1">
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-500 text-xs"
          >
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.chunksProcessed != null && (
              <span>{progress.chunksProcessed} chunks</span>
            )}
            {progress.totalSegments != null && (
              <span>
                {progress.segment ?? 0}/{progress.totalSegments} segments
              </span>
            )}
            {progress.entityCount != null && (
              <span>{progress.entityCount} entities</span>
            )}
            {progress.emojiCount != null && (
              <span>{progress.emojiCount} emoji</span>
            )}
            {progress.relationshipsCreated != null && (
              <span>{progress.relationshipsCreated} links</span>
            )}
            {progress.agreementCount != null && (
              <span>{progress.agreementCount} agreements</span>
            )}
          </div>
        </div>
      );
    }
  }

  // --- Transcription Sequence Creator ---
  if (job.type === "transcription_sequence_creator") {
    if (isCompleted) {
      if ((result.processed ?? 0) === 0) {
        return (
          <Badge
            variant="secondary"
            className="bg-amber-500/10 text-amber-500 text-xs"
          >
            Empty
          </Badge>
        );
      }
      return (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{result.processed} processed</span>
          {result.hasMore && <span className="text-amber-400">has more</span>}
        </div>
      );
    }
    if (progress.processed != null || progress.sequencesCreated != null) {
      return (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {progress.processed != null && (
            <span>{progress.processed} processed</span>
          )}
          {progress.sequencesCreated != null && (
            <span>{progress.sequencesCreated} sequences</span>
          )}
        </div>
      );
    }
  }

  // --- Tagger ---
  if (job.type === "tagger") {
    if (isCompleted) {
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.conversationsProcessed != null && (
              <span>{result.conversationsProcessed} conversations</span>
            )}
            {result.tagsApplied != null && (
              <span>{result.tagsApplied} tags</span>
            )}
            {result.errors?.length > 0 && (
              <span className="text-red-400">
                {result.errors.length} errors
              </span>
            )}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (isActive && progress) {
      return (
        <div className="space-y-1">
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-500 text-xs"
          >
            Tagging
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.current != null && progress.total != null && (
              <span>{progress.current}/{progress.total}</span>
            )}
          </div>
        </div>
      );
    }
  }

  // --- Summarization ---
  if (job.type === "summarization") {
    if (isCompleted) {
      if (!result.success) {
        return (
          <div className="space-y-1">
            <Badge
              variant="secondary"
              className="bg-red-500/10 text-red-500 text-xs"
            >
              Failed
            </Badge>
            {result.message && (
              <div className="text-xs text-red-400 truncate max-w-[200px]">
                {result.message}
              </div>
            )}
          </div>
        );
      }
      const start = result.start ? new Date(result.start) : null;
      const end = result.end ? new Date(result.end) : null;
      return (
        <div className="space-y-1">
          {start && end && (
            <Link
              to={`/timeline?start=${start.getTime()}&end=${end.getTime()}`}
              className="text-xs text-primary hover:underline"
            >
              {format(start, "MMM d, HH:mm")} — {format(end, "HH:mm")}
            </Link>
          )}
          {result.title && (
            <div
              className="text-xs text-muted-foreground truncate max-w-[200px]"
              title={result.title}
            >
              {result.title}
            </div>
          )}
          {result.objectId && (
            <Link
              to={`/objects/${result.objectId}`}
              className="text-xs text-primary hover:underline"
            >
              view conversation
            </Link>
          )}
        </div>
      );
    }
  }

  // --- Diarization ---
  if (job.type === "diarization") {
    if (isCompleted) {
      if (result.message && (result.sequences_processed ?? 0) === 0) {
        return (
          <span className="text-xs text-muted-foreground">
            {result.message}
          </span>
        );
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.sequences_processed != null && (
              <span>{result.sequences_processed} sequences</span>
            )}
            {result.chunks_processed != null && (
              <span>{result.chunks_processed} chunks</span>
            )}
            {result.segments_created != null && (
              <span>{result.segments_created} segments</span>
            )}
            {result.errors != null && result.errors > 0 && (
              <span className="text-red-400">{result.errors} errors</span>
            )}
          </div>
        </div>
      );
    }
    if (isActive && progress.stage) {
      const stageLabels: Record<string, string> = {
        counting: "Counting",
        processing: "Processing",
      };
      return (
        <div className="space-y-1">
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-500 text-xs"
          >
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.total_chunks != null && (
              <span>{progress.total_chunks} total chunks</span>
            )}
            {progress.sequences_processed != null && (
              <span>{progress.sequences_processed} sequences</span>
            )}
            {progress.chunks_processed != null && (
              <span>{progress.chunks_processed} chunks</span>
            )}
            {progress.segments_created != null && (
              <span>{progress.segments_created} segments</span>
            )}
          </div>
        </div>
      );
    }
  }

  // --- Hist Recalculation ---
  if (job.type === "histRecalculation") {
    if (isCompleted) {
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.processed != null && (
              <span>{result.processed} processed</span>
            )}
            {result.marked != null && <span>{result.marked} marked stale</span>}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
  }

  // --- Speaker Matching ---
  if (job.type === "speakerMatching") {
    if (isCompleted) {
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.processed != null && (
              <span>{result.processed} processed</span>
            )}
            {result.matched != null && <span>{result.matched} matched</span>}
            {result.profiles_count != null && (
              <span>{result.profiles_count} profiles</span>
            )}
            {result.duration != null && (
              <span>{result.duration.toFixed(1)}s</span>
            )}
            {result.has_more && (
              <span className="text-amber-400">has more</span>
            )}
          </div>
        </div>
      );
    }
    if (isActive && progress) {
      const stageLabels: Record<string, string> = {
        loading_profiles: "Loading profiles",
        loading_segments: "Loading segments",
        matching: "Matching",
      };
      return (
        <div className="space-y-1">
          {progress.stage && (
            <Badge
              variant="secondary"
              className="bg-blue-500/10 text-blue-500 text-xs"
            >
              {stageLabels[progress.stage] ?? progress.stage}
            </Badge>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.processed != null && progress.total != null && (
              <span>{progress.processed}/{progress.total}</span>
            )}
            {progress.matched != null && (
              <span>{progress.matched} matched</span>
            )}
          </div>
        </div>
      );
    }
  }

  // --- Enrollment ---
  if (job.type === "enrollment") {
    if (isCompleted) {
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.profile_name && <span>{result.profile_name}</span>}
            {result.sample_count != null && (
              <span>{result.sample_count} samples</span>
            )}
            {result.total_duration != null && (
              <span>{result.total_duration.toFixed(1)}s</span>
            )}
            {result.is_primary && (
              <Badge
                variant="secondary"
                className="bg-green-500/10 text-green-500 text-xs"
              >
                primary
              </Badge>
            )}
          </div>
        </div>
      );
    }
    if (isActive && progress.stage) {
      const stageLabels: Record<string, string> = {
        loading_audio: "Loading audio",
        extracting_embedding: "Extracting",
        saving_profile: "Saving",
      };
      return (
        <div className="space-y-1">
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-500 text-xs"
          >
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          {progress.message && (
            <div className="text-xs text-muted-foreground">
              {progress.message}
            </div>
          )}
        </div>
      );
    }
  }

  // --- Generic fallback for any job with progress ---
  if (job.progress && typeof job.progress === "object") {
    const percentage = (() => {
      const p = job.progress;
      if (typeof p.progress === "number") return p.progress;
      if (
        typeof p.processed === "number" && typeof p.total === "number" &&
        p.total > 0
      ) {
        return (p.processed / p.total) * 100;
      }
      if (
        typeof p.iteration === "number" && typeof p.total === "number" &&
        p.total > 0
      ) {
        return (p.iteration / p.total) * 100;
      }
      return null;
    })();
    return (
      <div className="space-y-2">
        {percentage !== null && <Progress value={percentage} className="h-2" />}
        <div className="text-xs space-y-1">
          {Object.entries(job.progress).slice(0, 3).map(([k, v]) => (
            <div key={k}>
              <span className="opacity-70">{k}:</span> {String(v)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return <span className="text-muted-foreground">-</span>;
}

export default function JobsPage() {
  const ALL_STATUSES = ["active", "waiting", "completed", "failed", "delayed"];
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const hideEmpty = searchParams.get("hideEmpty") === "true";
  const typeParam = searchParams.get("type");
  const [quickFilter, setQuickFilter] = useState<string>("all");
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(
    new Set(ALL_STATUSES),
  );
  const [filterTypes, setFilterTypes] = useState<Set<string>>(() => {
    if (typeParam) return new Set(typeParam.split(",").filter(Boolean));
    return new Set();
  });
  const [allTypesSelected, setAllTypesSelected] = useState(!typeParam);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);
  const [sortColumn, setSortColumn] = useState<string>("timestamp");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedSttModel, setSelectedSttModel] = useState("");
  const [serviceTestResults, setServiceTestResults] = useState<
    Partial<Record<"stt" | "llm", string>>
  >({});

  const toggleHideEmpty = () => {
    const newParams = new URLSearchParams(searchParams);
    if (hideEmpty) {
      newParams.delete("hideEmpty");
    } else {
      newParams.set("hideEmpty", "true");
    }
    setSearchParams(newParams);
  };

  const syncTypeToUrl = (types: Set<string>, allSelected: boolean) => {
    const newParams = new URLSearchParams(searchParams);
    if (allSelected || types.size === 0) {
      newParams.delete("type");
    } else {
      newParams.set("type", Array.from(types).join(","));
    }
    setSearchParams(newParams);
  };

  const { jobs, isLoading } = useJobsListener({
    types: !allTypesSelected && filterTypes.size > 0
      ? Array.from(filterTypes)
      : undefined,
  });

  const { data: schemas, isLoading: isLoadingSchemas } = useQuery({
    queryKey: ["job-schemas"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "schemas",
      });
      return response as Record<string, any>;
    },
  });

  const { data: workerStatus, refetch: refetchWorkerStatus } = useQuery({
    queryKey: ["worker-status"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "get_worker_status",
      });
      return response as WorkerStatus;
    },
  });

  const {
    data: pipelineHealth,
    isFetching: isFetchingPipelineHealth,
    refetch: refetchPipelineHealth,
  } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: async () => {
      return await api.callResource("jobs", {
        action: "pipeline_health",
      }) as PipelineHealth;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: inferenceRoutingConfig } = useQuery({
    queryKey: ["inference-routing-config"],
    queryFn: async () =>
      await api.callResource("config", {
        action: "get",
      }) as InferenceRoutingConfig,
  });

  useEffect(() => {
    const activeId = inferenceRoutingConfig?.llmProfiles?.activeProfileId;
    if (activeId) setSelectedProfileId(activeId);
    const configuredSttModel = inferenceRoutingConfig?.transcription?.model;
    if (configuredSttModel) setSelectedSttModel(configuredSttModel);
  }, [inferenceRoutingConfig]);

  // Fetch job statistics from backend (aggregates ALL jobs, not just the 1000 loaded in frontend)
  const { data: jobStatsResponse } = useQuery({
    queryKey: ["job-stats"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "stats",
      });
      return response as {
        stats: Array<{
          type: string;
          totalRuns: number;
          active: number;
          staleActive: number;
          staleClaims: number;
          waiting: number;
          delayed: number;
          completed: number;
          failed: number;
          emptyRuns: number;
          successRate: number;
          avgFrequency: string;
        }>;
        totals: {
          active: number;
          waiting: number;
          completed: number;
          failed: number;
          delayed: number;
          cancelled: number;
          total: number;
        };
      };
    },
    staleTime: 30000, // Refresh every 30 seconds
  });

  const pauseWorkerMutation = useMutation({
    mutationFn: async (workerType: string) => {
      await api.callResource("jobs", {
        action: "pause_worker",
        workerType,
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const resumeWorkerMutation = useMutation({
    mutationFn: async (workerType: string) => {
      await api.callResource("jobs", {
        action: "resume_worker",
        workerType,
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const pauseAllMutation = useMutation({
    mutationFn: async () => {
      await api.callResource("jobs", {
        action: "pause_all",
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const resumeAllMutation = useMutation({
    mutationFn: async () => {
      await api.callResource("jobs", {
        action: "resume_all",
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const resumePipelineMutation = useMutation({
    mutationFn: async (workerTypes: string[]) => {
      // Worker pause flags share one config document. Persist sequentially so
      // concurrent read-modify-write requests cannot overwrite each other.
      for (const workerType of workerTypes) {
        await api.callResource("jobs", {
          action: "resume_worker",
          workerType,
        });
      }
    },
    onSuccess: () => {
      refetchWorkerStatus();
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job-stats"] });
    },
  });

  const setServiceWorkersPausedMutation = useMutation({
    mutationFn: async ({
      workerTypes,
      paused,
    }: {
      workerTypes: string[];
      paused: boolean;
    }) => {
      for (const workerType of workerTypes) {
        await api.callResource("jobs", {
          action: paused ? "pause_worker" : "resume_worker",
          workerType,
        });
      }
    },
    onSuccess: () => {
      refetchWorkerStatus();
      refetchPipelineHealth();
    },
  });

  const runBacklogMutation = useMutation({
    mutationFn: async (workerType: string) => {
      return await api.callResource("jobs", {
        action: "enqueue",
        data: { type: workerType },
        trigger: {
          type: "manual",
          reason: "pipeline_health_run_now",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job-stats"] });
      refetchPipelineHealth();
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to launch job");
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: async (workerType: string) => {
      return await api.callResource("jobs", {
        action: "retry_failed",
        workerType,
        limit: 1,
      }) as { retriedCount: number; workerType: string; errors?: string[] };
    },
    onSuccess: (result) => {
      alert(
        result.retriedCount > 0
          ? `Started a recovery job for ${result.workerType}. The original failure remains in history.`
          : `No unretried ${result.workerType} failures found.`,
      );
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job-stats"] });
      refetchPipelineHealth();
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : "Failed to retry job");
    },
  });

  const testServicesMutation = useMutation({
    mutationFn: async () => {
      return await api.callResource("jobs", {
        action: "pipeline_health",
        force: true,
      }) as PipelineHealth;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["pipeline-health"], result);
    },
    onError: (error) => {
      alert(
        error instanceof Error ? error.message : "Connection test failed",
      );
    },
  });

  const testServiceMutation = useMutation({
    mutationFn: async (serviceId: "stt" | "llm") => {
      const fresh = await api.callResource("jobs", {
        action: "pipeline_health",
        force: true,
      }) as PipelineHealth;

      if (serviceId === "stt") {
        const modelsResult = await api.callResource("transcription", {
          action: "models",
        }) as {
          success: boolean;
          status: number;
          message: string;
          models: string[];
        };
        fresh.services = fresh.services.map((service) =>
          service.id === "stt"
            ? {
              ...service,
              status: modelsResult.success ? "healthy" : "unavailable",
              httpStatus: modelsResult.status,
              message: modelsResult.message,
              models: modelsResult.models,
            }
            : service
        );
      }
      return { serviceId, health: fresh };
    },
    onSuccess: ({ serviceId, health }) => {
      queryClient.setQueryData(["pipeline-health"], health);
      const service = health.services.find((item) => item.id === serviceId);
      setServiceTestResults((current) => ({
        ...current,
        [serviceId]: service
          ? `${service.message}${
            service.models?.length ? ` · ${service.models.length} model(s)` : ""
          }`
          : "Service result unavailable",
      }));
      if (serviceId === "stt" && service?.models?.length) {
        const currentModel = selectedSttModel || service.model || "";
        if (!service.models.includes(currentModel)) {
          setSelectedSttModel(service.models[0]);
        }
      }
    },
    onError: (error, serviceId) => {
      setServiceTestResults((current) => ({
        ...current,
        [serviceId]: error instanceof Error
          ? error.message
          : "Connection test failed",
      }));
    },
  });

  const saveActiveProfileMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const profiles = inferenceRoutingConfig?.llmProfiles?.profiles || [];
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (!profile) throw new Error("Choose a valid LLM preset");
      const model = profile.aliases[profile.defaultAlias];
      return await api.callResource("config", {
        action: "patch",
        updates: {
          llmProfiles: { activeProfileId: profile.id },
          llm: {
            baseUrl: profile.baseUrl,
            apiKey: profile.apiKey,
            model,
          },
          inference: {
            baseUrl: profile.baseUrl,
            apiKey: profile.apiKey,
            model,
          },
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inference-routing-config"] });
      refetchPipelineHealth();
      setServiceTestResults((current) => ({
        ...current,
        llm: "Preset saved. Test LLM to refresh the effective route.",
      }));
    },
    onError: (error) => {
      setServiceTestResults((current) => ({
        ...current,
        llm: error instanceof Error ? error.message : "Failed to save preset",
      }));
    },
  });

  const saveSttModelMutation = useMutation({
    mutationFn: async (model: string) => {
      if (!model) throw new Error("Choose an STT model first");
      return await api.callResource("config", {
        action: "patch",
        path: "transcription",
        updates: { model },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inference-routing-config"] });
      refetchPipelineHealth();
      setServiceTestResults((current) => ({
        ...current,
        stt: "STT model saved. New transcription jobs will use it.",
      }));
    },
    onError: (error) => {
      setServiceTestResults((current) => ({
        ...current,
        stt: error instanceof Error
          ? error.message
          : "Failed to save STT model",
      }));
    },
  });

  const clearQueueMutation = useMutation({
    mutationFn: async (workerType: string) => {
      return await api.callResource("jobs", {
        action: "clear_queue",
        workerType,
      }) as { cancelledCount?: number; workerType: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job-stats"] });
      alert(
        `Cleared ${
          result.cancelledCount ?? 0
        } queued ${result.workerType} job(s).`,
      );
    },
    onError: (error) => {
      console.error("Failed to clear worker queue:", error);
      alert("Failed to clear worker queue");
    },
  });

  const resetWorkerMutation = useMutation({
    mutationFn: async (workerType: string) => {
      return await api.callResource("jobs", {
        action: "reset_worker",
        workerType,
        restart: true,
      }) as {
        workerType: string;
        cancelledCount: number;
        terminatedCount: number;
        claimsCleared: number;
        restartedJobId?: string;
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job-stats"] });
      refetchWorkerStatus();
      alert(
        `Reset ${result.workerType}: cancelled ${result.cancelledCount} job(s), ` +
          `stopped ${result.terminatedCount} active process(es), cleared ` +
          `${result.claimsCleared} claim(s), and started one fresh job.`,
      );
    },
    onError: (error) => {
      console.error("Failed to reset worker:", error);
      alert("Failed to reset worker");
    },
  });

  const allTypes = useMemo(() => Object.keys(schemas || {}), [schemas]);

  const allPaused = useMemo(() => {
    if (!workerStatus?.workers || allTypes.length === 0) return false;
    return allTypes.every((type) => workerStatus.workers[type]?.paused);
  }, [workerStatus, allTypes]);

  const somePaused = useMemo(() => {
    if (!workerStatus?.workers) return false;
    return Object.values(workerStatus.workers).some((w) => w.paused);
  }, [workerStatus]);

  const pausedPipelineWorkers = useMemo(() => {
    if (!workerStatus?.workers) return [];
    return WORKER_PIPELINE
      .filter((worker) =>
        CRITICAL_PIPELINE_WORKERS.has(worker.type) &&
        workerStatus.workers[worker.type]?.paused
      )
      .map((worker) => worker.type);
  }, [workerStatus]);

  // Job counts by status (respects type filter)
  const jobCounts = useMemo(() => {
    const counts = {
      active: 0,
      waiting: 0,
      failed: 0,
      completed: 0,
      delayed: 0,
      total: 0,
      emptyTranscriptions: 0,
    };

    // Filter jobs by type if type filter is active
    const typeFilteredJobs = allTypesSelected
      ? jobs
      : jobs.filter((j) => filterTypes.has(j.type));

    for (const job of typeFilteredJobs) {
      counts.total++;
      if (job.state in counts) {
        counts[job.state as keyof typeof counts]++;
      }
      // Count empty transcriptions
      if (
        job.type === "transcription" && job.state === "completed" &&
        isEmptyJobResult(job)
      ) {
        counts.emptyTranscriptions++;
      }
    }
    return counts;
  }, [jobs, allTypesSelected, filterTypes]);

  // Aggregate backend stats for selected types (accurate totals when filtering)
  const filteredTypeTotals = useMemo(() => {
    if (!jobStatsResponse?.stats || allTypesSelected) return null;

    const totals = {
      active: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0,
      emptyRuns: 0,
    };
    for (const stat of jobStatsResponse.stats) {
      if (filterTypes.has(stat.type)) {
        totals.active += stat.active || 0;
        totals.waiting += stat.waiting || 0;
        totals.delayed += stat.delayed || 0;
        totals.completed += stat.completed || 0;
        totals.failed += stat.failed || 0;
        totals.total += stat.totalRuns || 0;
        totals.emptyRuns += stat.emptyRuns || 0;
      }
    }
    return totals;
  }, [jobStatsResponse, allTypesSelected, filterTypes]);

  // Calculate total empty runs from backend stats (for adjusting counts when hideEmpty is on)
  const totalEmptyRuns = useMemo(() => {
    if (!jobStatsResponse?.stats) return 0;
    return jobStatsResponse.stats.reduce(
      (sum, stat) => sum + (stat.emptyRuns || 0),
      0,
    );
  }, [jobStatsResponse]);

  // Get display counts adjusted for hideEmpty filter
  const displayCounts = useMemo(() => {
    if (allTypesSelected) {
      const totals = jobStatsResponse?.totals;
      if (!totals) return jobCounts;

      const emptyAdjust = hideEmpty ? totalEmptyRuns : 0;
      return {
        active: totals.active ?? jobCounts.active,
        waiting: totals.waiting ?? jobCounts.waiting,
        failed: totals.failed ?? jobCounts.failed,
        // Empty jobs are completed, so subtract from completed and total
        completed: (totals.completed ?? jobCounts.completed) - emptyAdjust,
        delayed: totals.delayed ?? jobCounts.delayed,
        total: (totals.total ?? jobCounts.total) - emptyAdjust,
      };
    } else {
      const totals = filteredTypeTotals;
      if (!totals) return jobCounts;

      const emptyAdjust = hideEmpty ? totals.emptyRuns : 0;
      return {
        active: totals.active,
        waiting: totals.waiting,
        failed: totals.failed,
        completed: totals.completed - emptyAdjust,
        delayed: totals.delayed,
        total: totals.total - emptyAdjust,
      };
    }
  }, [
    allTypesSelected,
    jobStatsResponse,
    filteredTypeTotals,
    jobCounts,
    hideEmpty,
    totalEmptyRuns,
  ]);

  // Get workers sorted by pipeline order, with unknown workers at the end
  const sortedWorkers = useMemo(() => {
    const pipelineOrder = new Map<string, number>(
      WORKER_PIPELINE.map((w, i) => [w.type, i]),
    );
    const pipelineDescriptions = new Map<string, string>(
      WORKER_PIPELINE.map((w) => [w.type, w.description]),
    );

    return [...allTypes].sort((a, b) => {
      const orderA = pipelineOrder.get(a) ?? 999;
      const orderB = pipelineOrder.get(b) ?? 999;
      return orderA - orderB;
    }).map((type) => ({
      type,
      description: pipelineDescriptions.get(type) || "Worker process",
      order: pipelineOrder.get(type) ?? 999,
    }));
  }, [allTypes]);

  // Job type statistics from backend (aggregates ALL jobs in database)
  const jobTypeStats = useMemo(() => {
    if (!jobStatsResponse?.stats) return [];

    const pipelineOrder = new Map<string, number>(
      WORKER_PIPELINE.map((w, i) => [w.type, i]),
    );
    return [...jobStatsResponse.stats].sort((a, b) => {
      const orderA = pipelineOrder.get(a.type) ?? 999;
      const orderB = pipelineOrder.get(b.type) ?? 999;
      return orderA - orderB;
    });
  }, [jobStatsResponse]);

  const handleToggleWorker = (workerType: string, currentlyPaused: boolean) => {
    if (currentlyPaused) {
      resumeWorkerMutation.mutate(workerType);
    } else {
      pauseWorkerMutation.mutate(workerType);
    }
  };

  const handleClearWorkerQueue = (
    workerType: string,
    active: number,
    waiting: number,
    delayed: number,
  ) => {
    const total = waiting + delayed;
    if (total === 0) return;

    const activeNotice = active > 0
      ? `\n\n${active} active job(s) will keep running. Pause the worker first if you do not want another queued job to start.`
      : "";

    if (
      confirm(
        `Clear the ${workerType} queue?\n\n` +
          `${waiting} waiting and ${delayed} delayed job(s) will be cancelled.` +
          activeNotice +
          "\n\n" +
          "Other worker queues and completed job history will not be changed.",
      )
    ) {
      clearQueueMutation.mutate(workerType);
    }
  };

  const handleResetWorker = (
    workerType: string,
    active: number,
    waiting: number,
    delayed: number,
    staleClaims: number,
  ) => {
    if (
      confirm(
        `Reset and restart ${workerType}?\n\n` +
          `This will stop ${active} active job(s), cancel ${
            waiting + delayed
          } queued job(s), ` +
          `and clear ${staleClaims} stale claim(s).\n\n` +
          "Exactly one fresh job will then be started.",
      )
    ) {
      resetWorkerMutation.mutate(workerType);
    }
  };

  const filteredJobs = useMemo(() => {
    let result = jobs;

    // Apply quick filter first
    if (quickFilter !== "all") {
      result = result.filter((j) => j.state === quickFilter);
    } else {
      // Apply multi-select status filter only when quick filter is "all"
      if (
        filterStatuses.size > 0 && filterStatuses.size < ALL_STATUSES.length
      ) {
        result = result.filter((j) => filterStatuses.has(j.state));
      } else if (filterStatuses.size === 0) {
        result = [];
      }
    }

    // Apply type filter
    if (!allTypesSelected) {
      if (filterTypes.size === 0) {
        result = [];
      } else {
        result = result.filter((j) => filterTypes.has(j.type));
      }
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((j) =>
        j.id.toLowerCase().includes(query) ||
        j.type.toLowerCase().includes(query)
      );
    }

    // Apply hide empty filter
    if (hideEmpty) {
      result = result.filter((job) => {
        // Only filter completed jobs - keep active/waiting/failed visible
        if (job.state !== "completed") return true;
        return !isEmptyJobResult(job);
      });
    }

    // Sort the results
    const sortedResult = [...result].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case "priority": {
          // Primary: status priority, Secondary: timestamp (desc)
          const priorityA = STATUS_PRIORITY[a.state] ?? 999;
          const priorityB = STATUS_PRIORITY[b.state] ?? 999;
          if (priorityA !== priorityB) {
            return sortDirection === "asc"
              ? priorityA - priorityB
              : priorityB - priorityA;
          }
          // Secondary sort by timestamp (most recent first)
          return (b.timestamp || 0) - (a.timestamp || 0);
        }
        case "state":
          aVal = a.state;
          bVal = b.state;
          break;
        case "type":
          aVal = a.type;
          bVal = b.type;
          break;
        case "id":
          aVal = a.id;
          bVal = b.id;
          break;
        case "timestamp":
          aVal = a.timestamp || 0;
          bVal = b.timestamp || 0;
          break;
        case "duration":
          aVal = a.processedOn
            ? ((a.finishedOn || Date.now()) - a.processedOn)
            : 0;
          bVal = b.processedOn
            ? ((b.finishedOn || Date.now()) - b.processedOn)
            : 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sortedResult.slice(0, limit);
  }, [
    jobs,
    quickFilter,
    allTypesSelected,
    filterTypes,
    filterStatuses,
    searchQuery,
    limit,
    sortColumn,
    sortDirection,
    hideEmpty,
  ]);

  const refetch = () => {
    // Invalidate all jobs queries (both "all" and "filtered" variants)
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["job-stats"] });
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((prev) => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return sortDirection === "asc"
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const toggleStatus = (status: string) => {
    setFilterStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const selectAllStatuses = () => setFilterStatuses(new Set(ALL_STATUSES));
  const selectNoStatuses = () => setFilterStatuses(new Set());

  const toggleType = (type: string) => {
    if (allTypesSelected) {
      setAllTypesSelected(false);
      const allExceptThis = new Set(allTypes.filter((t) => t !== type));
      setFilterTypes(allExceptThis);
      syncTypeToUrl(allExceptThis, false);
    } else {
      setFilterTypes((prev) => {
        const next = new Set(prev);
        if (next.has(type)) {
          next.delete(type);
        } else {
          next.add(type);
        }
        if (next.size === allTypes.length) {
          setAllTypesSelected(true);
          syncTypeToUrl(new Set(), true);
          return new Set();
        }
        syncTypeToUrl(next, false);
        return next;
      });
    }
  };

  const selectAllTypes = () => {
    setAllTypesSelected(true);
    setFilterTypes(new Set());
    syncTypeToUrl(new Set(), true);
  };

  const selectNoTypes = () => {
    setAllTypesSelected(false);
    setFilterTypes(new Set());
    syncTypeToUrl(new Set(), false);
  };

  const selectOnlyType = (type: string) => {
    setAllTypesSelected(false);
    const types = new Set([type]);
    setFilterTypes(types);
    syncTypeToUrl(types, false);
  };

  const selectOnlyStatus = (status: string) => {
    setFilterStatuses(new Set([status]));
  };

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      quickFilter !== "all" ||
      !allTypesSelected ||
      filterStatuses.size !== ALL_STATUSES.length ||
      searchQuery !== "" ||
      hideEmpty
    );
  }, [
    quickFilter,
    allTypesSelected,
    filterStatuses.size,
    searchQuery,
    hideEmpty,
    ALL_STATUSES.length,
  ]);

  // Clear all filters
  const clearFilters = () => {
    setQuickFilter("all");
    setAllTypesSelected(true);
    setFilterTypes(new Set());
    setFilterStatuses(new Set(ALL_STATUSES));
    setSearchQuery("");
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("type");
    newParams.delete("hideEmpty");
    setSearchParams(newParams);
  };

  const getTypesLabel = () => {
    if (allTypesSelected) return "All Types";
    if (filterTypes.size === 0) return "No Types";
    if (filterTypes.size === 1) return Array.from(filterTypes)[0];
    return `${filterTypes.size} types`;
  };

  const getStatusesLabel = () => {
    if (filterStatuses.size === ALL_STATUSES.length) return "All Statuses";
    if (filterStatuses.size === 0) return "No Statuses";
    if (filterStatuses.size === 1) return Array.from(filterStatuses)[0];
    return `${filterStatuses.size} statuses`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500/10 text-green-500 hover:bg-green-500/20";
      case "failed":
        return "bg-red-500/10 text-red-500 hover:bg-red-500/20";
      case "active":
        return "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20";
      case "waiting":
        return "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20";
      default:
        return "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20";
    }
  };

  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleCancelAll = async () => {
    if (
      !confirm(
        "Clear all queued jobs? Active jobs will keep running so their locks and saved results remain consistent.",
      )
    ) {
      return;
    }

    try {
      await api.callResource("jobs", {
        action: "cancel_all",
      });
      refetch();
    } catch (error) {
      console.error("Failed to cancel jobs:", error);
      alert("Failed to cancel jobs");
    }
  };

  const handleClearCompleted = async () => {
    const confirmText = "DELETE";
    const userInput = prompt(
      `⚠️ DEV ONLY - DESTRUCTIVE ACTION ⚠️\n\n` +
        `This will permanently delete ALL completed, failed, and cancelled jobs from the database.\n\n` +
        `This action cannot be undone and the data cannot be recovered.\n\n` +
        `Type "${confirmText}" to confirm:`,
    );

    if (userInput !== confirmText) {
      if (userInput !== null) {
        alert("Deletion cancelled - confirmation text did not match.");
      }
      return;
    }

    try {
      const result = await api.callResource("jobs", {
        action: "clear_completed",
      });
      console.log(`Deleted ${result.deletedCount} jobs`);
      refetch();
    } catch (error) {
      console.error("Failed to clear completed jobs:", error);
      alert("Failed to clear completed jobs");
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">System Jobs</h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75">
              </span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500">
              </span>
            </span>
            Live
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            asChild
          >
            <Link to="/jobs/new">
              <Play className="h-4 w-4 mr-2" />
              Launch Job
            </Link>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => resumeAllMutation.mutate()}
            disabled={resumeAllMutation.isPending || !somePaused}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Resume All
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => pauseAllMutation.mutate()}
            disabled={pauseAllMutation.isPending || allPaused === true}
          >
            <PauseCircle className="h-4 w-4 mr-2" />
            Pause All
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancelAll}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Queued
          </Button>
          {import.meta.env.DEV && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCompleted}
              title="Dev only: Permanently delete completed jobs from database"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Completed (Dev)
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {pausedPipelineWorkers.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <div className="font-medium text-amber-500">
                  Processing pipeline is paused
                </div>
                <div className="text-sm text-muted-foreground">
                  Waiting jobs will not start while these stages are paused:
                  {" "}
                  {pausedPipelineWorkers.join(", ")}.
                </div>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() =>
                resumePipelineMutation.mutate(pausedPipelineWorkers)}
              disabled={resumePipelineMutation.isPending}
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              {resumePipelineMutation.isPending
                ? "Resuming…"
                : "Resume processing pipeline"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4" />
                External services & routing
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Dependent jobs are held before execution while a provider is
                unavailable or loading.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testServicesMutation.mutate()}
                disabled={testServicesMutation.isPending ||
                  isFetchingPipelineHealth}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    testServicesMutation.isPending ? "animate-spin" : ""
                  }`}
                />
                Refresh status
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/settings/inference">Configure routing</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!pipelineHealth
            ? (
              <div className="text-sm text-muted-foreground">
                Checking external services…
              </div>
            )
            : (
              <div className="grid gap-4 lg:grid-cols-2">
                {pipelineHealth.services.map((service) => {
                  const allPausedForService = service.usedBy.every(
                    (workerType) => workerStatus?.workers[workerType]?.paused,
                  );
                  const intentionallyPaused = allPausedForService &&
                    service.status !== "healthy";
                  const statusClass = intentionallyPaused
                    ? "bg-amber-500/10 text-amber-600"
                    : service.status === "healthy"
                    ? "bg-green-500/10 text-green-600"
                    : service.status === "loading"
                    ? "bg-amber-500/10 text-amber-600"
                    : "bg-red-500/10 text-red-600";
                  return (
                    <div
                      key={service.id}
                      className="space-y-3 rounded-lg border p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {intentionallyPaused
                            ? (
                              <PauseCircle className="mt-0.5 h-5 w-5 text-amber-500" />
                            )
                            : service.status === "healthy"
                            ? <Wifi className="mt-0.5 h-5 w-5 text-green-500" />
                            : (
                              <WifiOff className="mt-0.5 h-5 w-5 text-red-500" />
                            )}
                          <div>
                            <div className="font-medium">{service.label}</div>
                            <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                              {service.baseUrl || "Not configured"}
                            </div>
                          </div>
                        </div>
                        <Badge variant="secondary" className={statusClass}>
                          {intentionallyPaused
                            ? "paused intentionally"
                            : service.status}
                          {service.httpStatus
                            ? ` · HTTP ${service.httpStatus}`
                            : ""}
                        </Badge>
                      </div>

                      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          Source:{" "}
                          <span className="font-mono text-foreground">
                            {service.source || "none"}
                          </span>
                        </div>
                        {service.providerProfileName && (
                          <div>
                            Preset:{" "}
                            <span className="font-mono text-foreground">
                              {service.providerProfileName}
                            </span>
                          </div>
                        )}
                        <div>
                          Model:{" "}
                          <span className="font-mono text-foreground">
                            {service.model || service.models?.[0] || "unknown"}
                          </span>
                        </div>
                        <div>
                          Latency:{" "}
                          <span className="text-foreground">
                            {service.latencyMs != null
                              ? `${service.latencyMs} ms`
                              : "—"}
                          </span>
                        </div>
                        <div>
                          Checked:{" "}
                          <span className="text-foreground">
                            {format(new Date(service.checkedAt), "HH:mm:ss")}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`rounded p-2 text-xs ${
                          service.status === "healthy"
                            ? "bg-green-500/5"
                            : intentionallyPaused
                            ? "bg-amber-500/5 text-amber-700"
                            : "bg-red-500/5 text-red-500"
                        }`}
                      >
                        {intentionallyPaused
                          ? `Expected while all routed workers are paused. Last probe: ${service.message}`
                          : service.message}
                      </div>

                      {service.id === "llm" && (
                        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                          <Label className="text-xs">Preset for LLM jobs</Label>
                          <div className="flex flex-wrap gap-2">
                            <Select
                              value={selectedProfileId}
                              onValueChange={setSelectedProfileId}
                              disabled={!inferenceRoutingConfig?.llmProfiles
                                ?.profiles?.length}
                            >
                              <SelectTrigger className="min-w-52 flex-1">
                                <SelectValue placeholder="Choose LLM preset" />
                              </SelectTrigger>
                              <SelectContent>
                                {inferenceRoutingConfig?.llmProfiles?.profiles
                                  ?.map((profile) => (
                                    <SelectItem
                                      key={profile.id}
                                      value={profile.id}
                                    >
                                      {profile.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              onClick={() =>
                                saveActiveProfileMutation.mutate(
                                  selectedProfileId,
                                )}
                              disabled={!selectedProfileId ||
                                saveActiveProfileMutation.isPending ||
                                service.source === "llm_env"}
                              title={service.source === "llm_env"
                                ? "OPENAI_BASE_URL environment variables override saved presets"
                                : undefined}
                            >
                              <Save className="mr-2 h-3.5 w-3.5" />
                              Save preset
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => testServiceMutation.mutate("llm")}
                              disabled={testServiceMutation.isPending}
                            >
                              <RefreshCw
                                className={`mr-2 h-3.5 w-3.5 ${
                                  testServiceMutation.isPending &&
                                    testServiceMutation.variables === "llm"
                                    ? "animate-spin"
                                    : ""
                                }`}
                              />
                              Test LLM
                            </Button>
                          </div>
                          {(() => {
                            const profile = inferenceRoutingConfig?.llmProfiles
                              ?.profiles?.find((candidate) =>
                                candidate.id === selectedProfileId
                              );
                            if (!profile) return null;
                            return (
                              <p className="break-all font-mono text-xs text-muted-foreground">
                                default {profile.defaultAlias} →{" "}
                                {profile.aliases[profile.defaultAlias]}
                                {" · "}small → {profile.aliases.small}
                                {" · "}medium → {profile.aliases.medium}
                                {" · "}large → {profile.aliases.large}
                              </p>
                            );
                          })()}
                        </div>
                      )}

                      {service.id === "stt" && (
                        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                          <Label className="text-xs">
                            Model for transcription jobs
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            <Select
                              value={selectedSttModel}
                              onValueChange={setSelectedSttModel}
                              disabled={!service.models?.length}
                            >
                              <SelectTrigger className="min-w-52 flex-1">
                                <SelectValue placeholder="Load STT models first" />
                              </SelectTrigger>
                              <SelectContent>
                                {[
                                  ...new Set([
                                    ...(service.models || []),
                                    ...(selectedSttModel
                                      ? [selectedSttModel]
                                      : []),
                                  ]),
                                ].map((model) => (
                                  <SelectItem key={model} value={model}>
                                    {model}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              onClick={() =>
                                saveSttModelMutation.mutate(selectedSttModel)}
                              disabled={!selectedSttModel ||
                                saveSttModelMutation.isPending}
                            >
                              <Save className="mr-2 h-3.5 w-3.5" />
                              Save model
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => testServiceMutation.mutate("stt")}
                              disabled={testServiceMutation.isPending}
                            >
                              <RefreshCw
                                className={`mr-2 h-3.5 w-3.5 ${
                                  testServiceMutation.isPending &&
                                    testServiceMutation.variables === "stt"
                                    ? "animate-spin"
                                    : ""
                                }`}
                              />
                              Test & load models
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Gateway health and Whisper model discovery are
                            separate checks. The saved model is used even when
                            the STT URL and key come from environment variables.
                          </p>
                        </div>
                      )}

                      {serviceTestResults[service.id] && (
                        <div className="text-xs text-muted-foreground">
                          {serviceTestResults[service.id]}
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">
                          Routed workers: {service.usedBy.join(", ")}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setServiceWorkersPausedMutation.mutate({
                              workerTypes: service.usedBy,
                              paused: !allPausedForService,
                            })}
                          disabled={setServiceWorkersPausedMutation.isPending}
                        >
                          {allPausedForService
                            ? <PlayCircle className="mr-2 h-4 w-4" />
                            : <PauseCircle className="mr-2 h-4 w-4" />}
                          {allPausedForService
                            ? "Resume affected workers"
                            : "Pause affected workers"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Work ready now</CardTitle>
          <p className="text-xs text-muted-foreground">
            Domain backlog is counted independently of whether upstream workers
            are enabled. Failed job history is retained.
          </p>
        </CardHeader>
        <CardContent>
          {!pipelineHealth
            ? (
              <div className="text-sm text-muted-foreground">
                Calculating backlog…
              </div>
            )
            : (
              <div className="grid gap-4 md:grid-cols-3">
                {([
                  ["transcription", "Ready for transcription", "stt"],
                  [
                    "conversation_extractor",
                    "Ready for conversation extraction",
                    "llm",
                  ],
                  ["summarization", "Summary candidates", "llm"],
                ] as const).map(([workerType, label, serviceId]) => {
                  const backlog = pipelineHealth.backlogs[workerType];
                  const service = pipelineHealth.services.find((item) =>
                    item.id === serviceId
                  );
                  const stats = jobTypeStats.find((item) =>
                    item.type === workerType
                  );
                  const busy = (stats?.active ?? 0) + (stats?.waiting ?? 0) > 0;
                  const workerPaused =
                    workerStatus?.workers[workerType]?.paused ?? false;
                  const runnable = service?.status === "healthy" &&
                    !workerPaused && !busy;
                  return (
                    <div
                      key={workerType}
                      className="space-y-3 rounded-lg border p-4"
                    >
                      <div>
                        <div className="text-sm font-medium">{label}</div>
                        <div className="mt-1 text-3xl font-semibold">
                          {backlog.ready}
                        </div>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {backlog.processing != null && (
                          <div>Processing: {backlog.processing}</div>
                        )}
                        {backlog.retryableErrors != null && (
                          <div>
                            Retryable source errors: {backlog.retryableErrors}
                          </div>
                        )}
                        {backlog.missingTotal != null && (
                          <div>
                            Conversations missing summaries:{" "}
                            {backlog.missingTotal}
                          </div>
                        )}
                        {backlog.blockedWithoutTranscripts != null && (
                          <div>
                            Blocked without transcript:{" "}
                            {backlog.blockedWithoutTranscripts}
                          </div>
                        )}
                        <div>
                          Unretried failed jobs: {backlog.failedJobsUnretried}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => runBacklogMutation.mutate(workerType)}
                          disabled={!runnable || backlog.ready === 0 ||
                            runBacklogMutation.isPending}
                          title={workerPaused
                            ? "Resume this worker first"
                            : service?.status !== "healthy"
                            ? "Provider must be healthy"
                            : busy
                            ? "A job is already active or waiting"
                            : undefined}
                        >
                          <Play className="mr-2 h-3.5 w-3.5" />
                          Run now
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => retryFailedMutation.mutate(workerType)}
                          disabled={service?.status !== "healthy" ||
                            backlog.failedJobsUnretried === 0 ||
                            retryFailedMutation.isPending}
                        >
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          Retry one failed
                        </Button>
                      </div>
                      {workerPaused && (
                        <div className="text-xs text-amber-500">
                          Worker is paused
                        </div>
                      )}
                      {busy && (
                        <div className="text-xs text-blue-500">
                          A job is already active or waiting
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          {pipelineHealth?.recovery && (
            <div className="mt-4 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              {pipelineHealth.recovery.note}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Workers & Statistics */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Workers</CardTitle>
            {somePaused && (
              <Badge
                variant="secondary"
                className="bg-amber-500/10 text-amber-500 text-xs"
              >
                {sortedWorkers.filter((w) =>
                  workerStatus?.workers[w.type]?.paused
                ).length} paused
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingSchemas
            ? (
              <div className="p-4 text-muted-foreground text-sm">
                Loading workers...
              </div>
            )
            : (
              <Table>
                <TableHeader>
                  <TableRow className="h-8">
                    <TableHead className="w-[40px] pl-4">On</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead className="text-center w-[50px]">
                      Active
                    </TableHead>
                    <TableHead className="text-center w-[50px]">
                      Queue
                    </TableHead>
                    <TableHead className="text-center w-[50px]">
                      Stale
                    </TableHead>
                    <TableHead className="text-center w-[50px]">Err</TableHead>
                    <TableHead className="text-center w-[60px]">Runs</TableHead>
                    <TableHead className="text-center w-[70px]">
                      Success
                    </TableHead>
                    <TableHead className="text-center w-[50px]">
                      Empty
                    </TableHead>
                    <TableHead className="w-[80px]">Freq</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedWorkers.map((worker) => {
                    const isPaused =
                      workerStatus?.workers[worker.type]?.paused ?? false;
                    const isMutating = pauseWorkerMutation.isPending ||
                      resumeWorkerMutation.isPending;
                    const stats = jobTypeStats.find((s) =>
                      s.type === worker.type
                    );
                    return (
                      <TableRow
                        key={worker.type}
                        className={`h-9 ${isPaused ? "bg-amber-500/5" : ""}`}
                      >
                        <TableCell className="pl-4 py-1">
                          <Checkbox
                            checked={!isPaused}
                            onCheckedChange={() =>
                              handleToggleWorker(worker.type, isPaused)}
                            disabled={isMutating}
                            className="cursor-pointer"
                          />
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex items-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link to={`/jobs/new?type=${worker.type}`}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                  >
                                    <Play className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                                  </Button>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>
                                Run {worker.type} job
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={clearQueueMutation.isPending ||
                                    ((stats?.waiting ?? 0) +
                                        (stats?.delayed ?? 0) === 0)}
                                  onClick={() =>
                                    handleClearWorkerQueue(
                                      worker.type,
                                      stats?.active ?? 0,
                                      stats?.waiting ?? 0,
                                      stats?.delayed ?? 0,
                                    )}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Clear {worker.type} queue
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  disabled={resetWorkerMutation.isPending}
                                  onClick={() =>
                                    handleResetWorker(
                                      worker.type,
                                      stats?.active ?? 0,
                                      stats?.waiting ?? 0,
                                      stats?.delayed ?? 0,
                                      stats?.staleClaims ?? 0,
                                    )}
                                >
                                  <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                Reset state and start one fresh {worker.type}
                                {" "}
                                job
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground w-4">
                              {worker.order < 999 ? worker.order : ""}
                            </span>
                            <span
                              className={`text-sm ${
                                isPaused ? "text-muted-foreground" : ""
                              }`}
                            >
                              {worker.type}
                            </span>
                            <span className="text-xs text-muted-foreground hidden lg:inline">
                              — {worker.description}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-1">
                          {(stats?.active ?? 0) > 0
                            ? (
                              <span className="text-blue-500 text-sm font-medium">
                                {stats?.active}
                              </span>
                            )
                            : (
                              <span className="text-muted-foreground/50">
                                -
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="text-center py-1">
                          {(stats?.waiting ?? 0) > 0
                            ? (
                              <span className="text-yellow-500 text-sm font-medium">
                                {stats?.waiting}
                              </span>
                            )
                            : (
                              <span className="text-muted-foreground/50">
                                -
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="text-center py-1">
                          {((stats?.staleActive ?? 0) +
                              (stats?.staleClaims ?? 0)) > 0
                            ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-amber-500 text-sm font-medium cursor-help">
                                    {(stats?.staleActive ?? 0) +
                                      (stats?.staleClaims ?? 0)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {stats?.staleActive ?? 0} stale active job(s),
                                  {" "}
                                  {stats?.staleClaims ?? 0} stale claim(s)
                                </TooltipContent>
                              </Tooltip>
                            )
                            : (
                              <span className="text-muted-foreground/50">
                                -
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="text-center py-1">
                          {(stats?.failed ?? 0) > 0
                            ? (
                              <span className="text-red-500 text-sm font-medium">
                                {stats?.failed}
                              </span>
                            )
                            : (
                              <span className="text-muted-foreground/50">
                                -
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="text-center py-1 text-sm">
                          {stats?.totalRuns ?? "-"}
                        </TableCell>
                        <TableCell className="text-center py-1">
                          {stats
                            ? (
                              <Badge
                                variant="secondary"
                                className={stats.successRate >= 95
                                  ? "bg-green-500/10 text-green-600"
                                  : stats.successRate >= 80
                                  ? "bg-yellow-500/10 text-yellow-600"
                                  : "bg-red-500/10 text-red-600"}
                              >
                                {stats.successRate.toFixed(0)}%
                              </Badge>
                            )
                            : (
                              <span className="text-muted-foreground/50">
                                -
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="text-center py-1 text-sm text-muted-foreground">
                          {stats && stats.emptyRuns > 0 ? stats.emptyRuns : "-"}
                        </TableCell>
                        <TableCell className="py-1 text-sm text-muted-foreground">
                          {stats?.avgFrequency ?? "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
        </CardContent>
      </Card>

      {/* Quick Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={quickFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("all")}
        >
          All ({displayCounts.total})
        </Button>
        <Button
          variant={quickFilter === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("active")}
          className={quickFilter !== "active"
            ? "text-blue-500 hover:text-blue-600"
            : ""}
        >
          <Activity className="h-3.5 w-3.5 mr-1" />
          Active ({displayCounts.active})
        </Button>
        <Button
          variant={quickFilter === "waiting" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("waiting")}
          className={quickFilter !== "waiting"
            ? "text-yellow-500 hover:text-yellow-600"
            : ""}
        >
          <Clock className="h-3.5 w-3.5 mr-1" />
          Waiting ({displayCounts.waiting})
        </Button>
        <Button
          variant={quickFilter === "failed" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("failed")}
          className={quickFilter !== "failed"
            ? "text-red-500 hover:text-red-600 border-red-500/30"
            : ""}
        >
          <AlertCircle className="h-3.5 w-3.5 mr-1" />
          Errors ({displayCounts.failed})
        </Button>
        <Button
          variant={quickFilter === "completed" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("completed")}
          className={quickFilter !== "completed"
            ? "text-green-500 hover:text-green-600"
            : ""}
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          Completed ({displayCounts.completed})
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by ID or type..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[200px] justify-between">
                  {getTypesLabel()}
                  <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[200px]">
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={selectAllTypes}
                >
                  <Checkbox
                    checked={allTypesSelected}
                    className="mr-2"
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={(checked) =>
                      checked ? selectAllTypes() : selectNoTypes()}
                  />
                  All Types
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isLoadingSchemas
                  ? <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
                  : (
                    allTypes.map((type) => (
                      <DropdownMenuItem
                        key={type}
                        onSelect={(e) => e.preventDefault()}
                        onClick={() => toggleType(type)}
                        className="cursor-pointer"
                      >
                        <Checkbox
                          checked={allTypesSelected || filterTypes.has(type)}
                          className="mr-2"
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => toggleType(type)}
                        />
                        {type}
                      </DropdownMenuItem>
                    ))
                  )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-[200px] justify-between capitalize"
                >
                  {getStatusesLabel()}
                  <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[200px]">
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={selectAllStatuses}
                >
                  <Checkbox
                    checked={filterStatuses.size === ALL_STATUSES.length}
                    className="mr-2"
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={(checked) =>
                      checked ? selectAllStatuses() : selectNoStatuses()}
                  />
                  All Statuses
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {ALL_STATUSES.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onSelect={(e) => e.preventDefault()}
                    onClick={() => selectOnlyStatus(status)}
                    className="cursor-pointer capitalize"
                  >
                    <Checkbox
                      checked={filterStatuses.has(status)}
                      className="mr-2"
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleStatus(status)}
                    />
                    {status}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-[120px]">
              <Select
                value={limit.toString()}
                onValueChange={(v) => setLimit(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Limit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="hide-empty"
                checked={hideEmpty}
                onCheckedChange={toggleHideEmpty}
              />
              <Label htmlFor="hide-empty" className="text-sm cursor-pointer">
                Hide empty
              </Label>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("state")}
                >
                  <div className="flex items-center">
                    Status
                    <SortIcon column="state" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("type")}
                >
                  <div className="flex items-center">
                    Type
                    <SortIcon column="type" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("timestamp")}
                >
                  <div className="flex items-center">
                    Created
                    <SortIcon column="timestamp" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("duration")}
                >
                  <div className="flex items-center">
                    Duration
                    <SortIcon column="duration" />
                  </div>
                </TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="w-[80px] text-right">ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      Loading jobs...
                    </TableCell>
                  </TableRow>
                )
                : filteredJobs.length === 0
                ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      No jobs found
                    </TableCell>
                  </TableRow>
                )
                : (
                  filteredJobs.map((job) => (
                    <TableRow
                      key={job.id}
                      className={job.state === "failed"
                        ? "bg-red-500/5 border-l-2 border-l-red-500"
                        : ""}
                    >
                      <TableCell>
                        <Link
                          to={`/jobs/${job.id}`}
                        >
                          <Badge
                            variant="secondary"
                            className={getStatusColor(job.state)}
                          >
                            {job.state}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell
                        className="font-medium cursor-pointer hover:text-primary hover:underline"
                        onClick={() => selectOnlyType(job.type)}
                        title={`Filter by ${job.type}`}
                      >
                        {job.type}
                      </TableCell>
                      <TableCell className="text-sm">
                        {job.timestamp
                          ? format(new Date(job.timestamp), "MMM d, HH:mm:ss")
                          : "-"}
                      </TableCell>
                      <TableCell
                        className={job.restarted ||
                            (job.finishedOn && job.processedOn &&
                              job.finishedOn < job.processedOn)
                          ? "text-sm text-amber-500"
                          : "text-sm"}
                        title={job.finishedOn && job.processedOn &&
                            job.finishedOn < job.processedOn
                          ? "This job was restarted and still has stale timestamps from an earlier attempt"
                          : job.restarted
                          ? "This job has been restarted; duration is for the latest attempt"
                          : undefined}
                      >
                        {formatJobDuration(
                          job.processedOn,
                          job.finishedOn,
                          currentTime,
                        )}
                        {job.restarted && !(job.finishedOn && job.processedOn &&
                          job.finishedOn < job.processedOn) &&
                          <span className="ml-1 text-xs">(retry)</span>}
                      </TableCell>
                      <TableCell>
                        <JobProgressCell job={job} />
                      </TableCell>
                      <TableCell className="w-[80px] text-right p-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(job.id);
                                setCopiedId(job.id);
                                setTimeout(() => setCopiedId(null), 2000);
                              }}
                              className="font-mono text-xs text-muted-foreground hover:text-foreground cursor-pointer inline-flex items-center gap-1"
                            >
                              <span className="truncate max-w-[50px]">
                                {job.id.slice(-6)}
                              </span>
                              {copiedId === job.id
                                ? <Check className="h-3 w-3 text-green-500" />
                                : <Copy className="h-3 w-3 opacity-50" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{job.id}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
                )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
