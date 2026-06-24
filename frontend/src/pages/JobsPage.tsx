import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState, useEffect, useMemo } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, Play, Search, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, PlayCircle, PauseCircle, Activity, Clock, AlertCircle, CheckCircle, X, Copy, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

type WorkerStatus = {
  workers: Record<string, { paused: boolean }>;
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
  { type: "ingestion", order: 1, description: "Processes audio files into chunks" },
  { type: "vad", order: 2, description: "Voice Activity Detection on audio chunks" },
  { type: "transcription_sequence_creator", order: 3, description: "Groups speech chunks into sequences" },
  { type: "transcription", order: 4, description: "Transcribes sequences to text using LLM" },
  { type: "conversation_chunk_creator", order: 5, description: "Groups transcriptions into conversation chunks" },
  { type: "conversation_extractor", order: 6, description: "Extracts conversations and entities using LLM" },
  { type: "summarization", order: 7, description: "Generates summaries for conversations" },
  { type: "diarization", order: 8, description: "Speaker identification/diarization" },
  { type: "histRecalculation", order: 9, description: "Recalculates timeline histograms" },
] as const;

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
          : `from ${format(start, "MMM d, HH:mm")}`
      }
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
  const hasResult = job.result && typeof job.result === "object" && Object.keys(job.result).length > 0;
  const isCompleted = job.state === "completed" || (job.state === "active" && hasResult);
  const isActive = job.state === "active" && !hasResult;

  // --- Failed jobs: show parsed error ---
  if (job.state === "failed" && job.failedReason) {
    const error = parseJobError(job.failedReason);
    if (error) {
      return (
        <div className="space-y-1">
          <Badge variant="secondary" className="bg-red-500/10 text-red-500 text-xs">
            {error.label}
          </Badge>
          <div className="text-xs text-red-400/80 truncate max-w-[250px]" title={error.detail}>
            {error.detail}
          </div>
        </div>
      );
    }
  }

  // --- Transcription ---
  if (job.type === "transcription") {
    if (isCompleted) {
      const isEmpty = result.result === "empty"
        || (result.wordCount != null && result.wordCount === 0)
        || (result.processed === 0 && !result.transcriptionId);
      if (isEmpty) {
        // Use sequenceStart from result, progress, or fall back to job creation time
        const seqStart = result.sequenceStart || progress.sequenceStart || (job.timestamp ? new Date(job.timestamp).toISOString() : null);
        return (
          <div className="space-y-1">
            <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs">Empty</Badge>
            {seqStart && (
              <Link
                to={`/timeline?start=${new Date(seqStart).getTime()}&end=${new Date(seqStart).getTime() + (result.audioDuration || 60) * 1000 + 60000}`}
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
              to={`/timeline?start=${new Date(result.sequenceStart).getTime()}&end=${new Date(result.sequenceStart).getTime() + (result.audioDuration || 60) * 1000 + 60000}`}
              className="text-xs text-primary hover:underline"
            >
              {format(new Date(result.sequenceStart), "MMM d, HH:mm")}
            </Link>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.audioDuration != null && <span>{result.audioDuration.toFixed(1)}s</span>}
            {result.wordCount != null ? <span>{result.wordCount} words</span> : <span className="opacity-50">— words</span>}
            {result.segmentCount != null && <span>{result.segmentCount} segments</span>}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
          {result.textPreview && (
            <div className="text-xs text-muted-foreground/70 truncate max-w-[250px]" title={result.textPreview}>
              {result.textPreview}
            </div>
          )}
        </div>
      );
    }
    if (progress.stage) {
      const stageLabels: Record<string, string> = {
        processing: "Processing", fetching_chunks: "Fetching chunks", combining_audio: "Combining audio",
        transcribing: "Transcribing", saving_result: "Saving", empty_result: "Empty result",
        completed: "Finishing",
      };
      return (
        <div className="space-y-1">
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-xs">
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          {progress.sequenceStart && (
            <Link
              to={`/timeline?start=${new Date(progress.sequenceStart).getTime()}&end=${new Date(progress.sequenceStart).getTime() + 120000}`}
              className="text-xs text-primary hover:underline"
            >
              {format(new Date(progress.sequenceStart), "MMM d, HH:mm")}
            </Link>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.chunkCount != null && <span>{progress.chunkCount} chunks</span>}
            {progress.audioSize != null && <span>{(progress.audioSize / 1024).toFixed(0)} KB</span>}
            {progress.duration != null && <span>{progress.duration.toFixed(1)}s audio</span>}
          </div>
        </div>
      );
    }
  }

  // --- VAD ---
  if (job.type === "vad") {
    if (isCompleted) {
      if ((result.hasSpeech ?? 0) === 0 && (result.processed ?? 0) === 0) {
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs">Empty</Badge>;
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.processed != null && result.total != null && <span>{result.processed}/{result.total} processed</span>}
            {result.hasSpeech != null && <span>{result.hasSpeech} with speech</span>}
            {result.duration != null && <span>{result.duration.toFixed(1)}s</span>}
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
            {progress.processed != null && progress.total != null && <span>{progress.processed}/{progress.total} processed</span>}
            {progress.hasSpeech != null && <span>{progress.hasSpeech} with speech</span>}
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
      if ((result.finalized ?? 0) === 0 && (result.streamed ?? 0) === 0 && (result.chunksCreated ?? 0) === 0) {
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs">Empty</Badge>;
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.chunksCreated != null && <span>{result.chunksCreated} chunks</span>}
            {result.finalized != null && <span>{result.finalized} finalized</span>}
            {result.streamed != null && result.streamed > 0 && <span>{result.streamed} streamed</span>}
            {result.backfilled != null && result.backfilled > 0 && <span>{result.backfilled} backfilled</span>}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (isActive && progress.stage) {
      const stageLabels: Record<string, string> = {
        finalizing_stale: "Finalizing", streaming: "Streaming", backfilling: "Backfilling",
      };
      return (
        <div className="space-y-1">
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-xs">
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.finalized != null && <span>{progress.finalized} finalized</span>}
            {progress.streamed != null && <span>{progress.streamed} streamed</span>}
          </div>
        </div>
      );
    }
  }

  // --- Conversation Extractor ---
  if (job.type === "conversation_extractor") {
    if (isCompleted) {
      if ((result.conversationsCreated ?? 0) === 0 && (result.chunksProcessed ?? 0) === 0) {
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs">Empty</Badge>;
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.conversationsCreated != null && <span>{result.conversationsCreated} conversations</span>}
            {result.chunksProcessed != null && <span>{result.chunksProcessed} chunks</span>}
            {result.errors?.length > 0 && <span className="text-red-400">{result.errors.length} errors</span>}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (progress.stage) {
      const stageLabels: Record<string, string> = {
        processing_chunk: "Processing chunk", segmenting: "Segmenting", extracting_metadata: "Extracting metadata",
      };
      return (
        <div className="space-y-1">
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-xs">
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.chunksProcessed != null && <span>{progress.chunksProcessed} chunks</span>}
            {progress.totalSegments != null && <span>{progress.segment ?? 0}/{progress.totalSegments} segments</span>}
          </div>
        </div>
      );
    }
  }

  // --- Transcription Sequence Creator ---
  if (job.type === "transcription_sequence_creator") {
    if (isCompleted) {
      if ((result.processed ?? 0) === 0) {
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs">Empty</Badge>;
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
          {progress.processed != null && <span>{progress.processed} processed</span>}
          {progress.sequencesCreated != null && <span>{progress.sequencesCreated} sequences</span>}
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
            {result.conversationsProcessed != null && <span>{result.conversationsProcessed} conversations</span>}
            {result.tagsApplied != null && <span>{result.tagsApplied} tags</span>}
            {result.errors?.length > 0 && <span className="text-red-400">{result.errors.length} errors</span>}
            {result.hasMore && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (isActive && progress) {
      return (
        <div className="space-y-1">
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-xs">
            Tagging
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.current != null && progress.total != null && <span>{progress.current}/{progress.total}</span>}
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
            <Badge variant="secondary" className="bg-red-500/10 text-red-500 text-xs">Failed</Badge>
            {result.message && <div className="text-xs text-red-400 truncate max-w-[200px]">{result.message}</div>}
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
            <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={result.title}>
              {result.title}
            </div>
          )}
          {result.objectId && (
            <Link to={`/objects/${result.objectId}`} className="text-xs text-primary hover:underline">
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
        return <span className="text-xs text-muted-foreground">{result.message}</span>;
      }
      return (
        <div className="space-y-1">
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {result.sequences_processed != null && <span>{result.sequences_processed} sequences</span>}
            {result.chunks_processed != null && <span>{result.chunks_processed} chunks</span>}
            {result.segments_created != null && <span>{result.segments_created} segments</span>}
            {result.errors != null && result.errors > 0 && <span className="text-red-400">{result.errors} errors</span>}
          </div>
        </div>
      );
    }
    if (isActive && progress.stage) {
      const stageLabels: Record<string, string> = { counting: "Counting", processing: "Processing" };
      return (
        <div className="space-y-1">
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-xs">
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          <JobDateRange job={job} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.total_chunks != null && <span>{progress.total_chunks} total chunks</span>}
            {progress.sequences_processed != null && <span>{progress.sequences_processed} sequences</span>}
            {progress.chunks_processed != null && <span>{progress.chunks_processed} chunks</span>}
            {progress.segments_created != null && <span>{progress.segments_created} segments</span>}
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
            {result.processed != null && <span>{result.processed} processed</span>}
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
            {result.processed != null && <span>{result.processed} processed</span>}
            {result.matched != null && <span>{result.matched} matched</span>}
            {result.profiles_count != null && <span>{result.profiles_count} profiles</span>}
            {result.duration != null && <span>{result.duration.toFixed(1)}s</span>}
            {result.has_more && <span className="text-amber-400">has more</span>}
          </div>
        </div>
      );
    }
    if (isActive && progress) {
      const stageLabels: Record<string, string> = {
        loading_profiles: "Loading profiles", loading_segments: "Loading segments", matching: "Matching",
      };
      return (
        <div className="space-y-1">
          {progress.stage && (
            <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-xs">
              {stageLabels[progress.stage] ?? progress.stage}
            </Badge>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {progress.processed != null && progress.total != null && <span>{progress.processed}/{progress.total}</span>}
            {progress.matched != null && <span>{progress.matched} matched</span>}
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
            {result.sample_count != null && <span>{result.sample_count} samples</span>}
            {result.total_duration != null && <span>{result.total_duration.toFixed(1)}s</span>}
            {result.is_primary && <Badge variant="secondary" className="bg-green-500/10 text-green-500 text-xs">primary</Badge>}
          </div>
        </div>
      );
    }
    if (isActive && progress.stage) {
      const stageLabels: Record<string, string> = {
        loading_audio: "Loading audio", extracting_embedding: "Extracting", saving_profile: "Saving",
      };
      return (
        <div className="space-y-1">
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 text-xs">
            {stageLabels[progress.stage] ?? progress.stage}
          </Badge>
          {progress.message && <div className="text-xs text-muted-foreground">{progress.message}</div>}
        </div>
      );
    }
  }

  // --- Generic fallback for any job with progress ---
  if (job.progress && typeof job.progress === "object") {
    const percentage = (() => {
      const p = job.progress;
      if (typeof p.progress === "number") return p.progress;
      if (typeof p.processed === "number" && typeof p.total === "number" && p.total > 0)
        return (p.processed / p.total) * 100;
      if (typeof p.iteration === "number" && typeof p.total === "number" && p.total > 0)
        return (p.iteration / p.total) * 100;
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
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set(ALL_STATUSES));
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
    types: !allTypesSelected && filterTypes.size > 0 ? Array.from(filterTypes) : undefined,
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

  const allTypes = useMemo(() => Object.keys(schemas || {}), [schemas]);

  const allPaused = useMemo(() => {
    if (!workerStatus?.workers || allTypes.length === 0) return false;
    return allTypes.every(type => workerStatus.workers[type]?.paused);
  }, [workerStatus, allTypes]);

  const somePaused = useMemo(() => {
    if (!workerStatus?.workers) return false;
    return Object.values(workerStatus.workers).some(w => w.paused);
  }, [workerStatus]);

  // Job counts by status (respects type filter)
  const jobCounts = useMemo(() => {
    const counts = { active: 0, waiting: 0, failed: 0, completed: 0, delayed: 0, total: 0, emptyTranscriptions: 0 };

    // Filter jobs by type if type filter is active
    const typeFilteredJobs = allTypesSelected
      ? jobs
      : jobs.filter(j => filterTypes.has(j.type));

    for (const job of typeFilteredJobs) {
      counts.total++;
      if (job.state in counts) {
        counts[job.state as keyof typeof counts]++;
      }
      // Count empty transcriptions
      if (job.type === "transcription" && job.state === "completed" && isEmptyJobResult(job)) {
        counts.emptyTranscriptions++;
      }
    }
    return counts;
  }, [jobs, allTypesSelected, filterTypes]);

  // Aggregate backend stats for selected types (accurate totals when filtering)
  const filteredTypeTotals = useMemo(() => {
    if (!jobStatsResponse?.stats || allTypesSelected) return null;

    const totals = { active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0, total: 0, emptyRuns: 0 };
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
    return jobStatsResponse.stats.reduce((sum, stat) => sum + (stat.emptyRuns || 0), 0);
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
  }, [allTypesSelected, jobStatsResponse, filteredTypeTotals, jobCounts, hideEmpty, totalEmptyRuns]);

  // Get workers sorted by pipeline order, with unknown workers at the end
  const sortedWorkers = useMemo(() => {
    const pipelineOrder = new Map<string, number>(WORKER_PIPELINE.map((w, i) => [w.type, i]));
    const pipelineDescriptions = new Map<string, string>(WORKER_PIPELINE.map(w => [w.type, w.description]));

    return [...allTypes].sort((a, b) => {
      const orderA = pipelineOrder.get(a) ?? 999;
      const orderB = pipelineOrder.get(b) ?? 999;
      return orderA - orderB;
    }).map(type => ({
      type,
      description: pipelineDescriptions.get(type) || "Worker process",
      order: pipelineOrder.get(type) ?? 999,
    }));
  }, [allTypes]);

  // Job type statistics from backend (aggregates ALL jobs in database)
  const jobTypeStats = useMemo(() => {
    if (!jobStatsResponse?.stats) return [];

    const pipelineOrder = new Map<string, number>(WORKER_PIPELINE.map((w, i) => [w.type, i]));
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

  const filteredJobs = useMemo(() => {
    let result = jobs;

    // Apply quick filter first
    if (quickFilter !== "all") {
      result = result.filter(j => j.state === quickFilter);
    } else {
      // Apply multi-select status filter only when quick filter is "all"
      if (filterStatuses.size > 0 && filterStatuses.size < ALL_STATUSES.length) {
        result = result.filter(j => filterStatuses.has(j.state));
      } else if (filterStatuses.size === 0) {
        result = [];
      }
    }

    // Apply type filter
    if (!allTypesSelected) {
      if (filterTypes.size === 0) {
        result = [];
      } else {
        result = result.filter(j => filterTypes.has(j.type));
      }
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(j =>
        j.id.toLowerCase().includes(query) ||
        j.type.toLowerCase().includes(query)
      );
    }

    // Apply hide empty filter
    if (hideEmpty) {
      result = result.filter((job) => {
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
            return sortDirection === "asc" ? priorityA - priorityB : priorityB - priorityA;
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
          aVal = a.processedOn ? ((a.finishedOn || Date.now()) - a.processedOn) : 0;
          bVal = b.processedOn ? ((b.finishedOn || Date.now()) - b.processedOn) : 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sortedResult.slice(0, limit);
  }, [jobs, quickFilter, allTypesSelected, filterTypes, filterStatuses, searchQuery, limit, sortColumn, sortDirection, hideEmpty]);

  const refetch = () => {
    // Invalidate all jobs queries (both "all" and "filtered" variants)
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["job-stats"] });
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
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
    setFilterStatuses(prev => {
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
      const allExceptThis = new Set(allTypes.filter(t => t !== type));
      setFilterTypes(allExceptThis);
      syncTypeToUrl(allExceptThis, false);
    } else {
      setFilterTypes(prev => {
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
  }, [quickFilter, allTypesSelected, filterStatuses.size, searchQuery, hideEmpty, ALL_STATUSES.length]);

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

  const formatDuration = (start?: number, end?: number) => {
    if (!start) return "-";
    const endTime = end || currentTime;
    const ms = endTime - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const handleCancelAll = async () => {
    if (
      !confirm(
        "Are you sure you want to cancel all running jobs and clear queues? This action cannot be undone."
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">System Jobs</h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
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
            disabled={resumeAllMutation.isPending || allPaused === false}
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
            Cancel All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw
              className="h-4 w-4 mr-2"
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Workers & Statistics */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Workers</CardTitle>
            {somePaused && (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs">
                {sortedWorkers.filter(w => workerStatus?.workers[w.type]?.paused).length} paused
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingSchemas ? (
            <div className="p-4 text-muted-foreground text-sm">Loading workers...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="h-8">
                  <TableHead className="w-[40px] pl-4">On</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead className="text-center w-[50px]">Active</TableHead>
                  <TableHead className="text-center w-[50px]">Queue</TableHead>
                  <TableHead className="text-center w-[50px]">Err</TableHead>
                  <TableHead className="text-center w-[60px]">Runs</TableHead>
                  <TableHead className="text-center w-[70px]">Success</TableHead>
                  <TableHead className="text-center w-[50px]">Empty</TableHead>
                  <TableHead className="w-[80px]">Freq</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedWorkers.map((worker) => {
                  const isPaused = workerStatus?.workers[worker.type]?.paused ?? false;
                  const isMutating = pauseWorkerMutation.isPending || resumeWorkerMutation.isPending;
                  const stats = jobTypeStats.find(s => s.type === worker.type);
                  return (
                    <TableRow
                      key={worker.type}
                      className={`h-9 ${isPaused ? "bg-amber-500/5" : ""}`}
                    >
                      <TableCell className="pl-4 py-1">
                        <Checkbox
                          checked={!isPaused}
                          onCheckedChange={() => handleToggleWorker(worker.type, isPaused)}
                          disabled={isMutating}
                          className="cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="py-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link to={`/jobs/new?type=${worker.type}`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <Play className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
                              </Button>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>Run {worker.type} job</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="py-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground w-4">{worker.order < 999 ? worker.order : ""}</span>
                          <span className={`text-sm ${isPaused ? "text-muted-foreground" : ""}`}>{worker.type}</span>
                          <span className="text-xs text-muted-foreground hidden lg:inline">— {worker.description}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {(stats?.active ?? 0) > 0 ? (
                          <span className="text-blue-500 text-sm font-medium">{stats?.active}</span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {(stats?.waiting ?? 0) > 0 ? (
                          <span className="text-yellow-500 text-sm font-medium">{stats?.waiting}</span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {(stats?.failed ?? 0) > 0 ? (
                          <span className="text-red-500 text-sm font-medium">{stats?.failed}</span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-1 text-sm">
                        {stats?.totalRuns ?? "-"}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {stats ? (
                          <Badge variant="secondary" className={
                            stats.successRate >= 95 ? "bg-green-500/10 text-green-600" :
                            stats.successRate >= 80 ? "bg-yellow-500/10 text-yellow-600" :
                            "bg-red-500/10 text-red-600"
                          }>
                            {stats.successRate.toFixed(0)}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
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
          className={quickFilter !== "active" ? "text-blue-500 hover:text-blue-600" : ""}
        >
          <Activity className="h-3.5 w-3.5 mr-1" />
          Active ({displayCounts.active})
        </Button>
        <Button
          variant={quickFilter === "waiting" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("waiting")}
          className={quickFilter !== "waiting" ? "text-yellow-500 hover:text-yellow-600" : ""}
        >
          <Clock className="h-3.5 w-3.5 mr-1" />
          Waiting ({displayCounts.waiting})
        </Button>
        <Button
          variant={quickFilter === "failed" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("failed")}
          className={quickFilter !== "failed" ? "text-red-500 hover:text-red-600 border-red-500/30" : ""}
        >
          <AlertCircle className="h-3.5 w-3.5 mr-1" />
          Errors ({displayCounts.failed})
        </Button>
        <Button
          variant={quickFilter === "completed" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("completed")}
          className={quickFilter !== "completed" ? "text-green-500 hover:text-green-600" : ""}
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
              <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={selectAllTypes}>
                <Checkbox
                  checked={allTypesSelected}
                  className="mr-2"
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(checked) => checked ? selectAllTypes() : selectNoTypes()}
                />
                All Types
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isLoadingSchemas ? (
                <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
              ) : (
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
              <Button variant="outline" className="w-[200px] justify-between capitalize">
                {getStatusesLabel()}
                <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]">
              <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={selectAllStatuses}>
                <Checkbox
                  checked={filterStatuses.size === ALL_STATUSES.length}
                  className="mr-2"
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(checked) => checked ? selectAllStatuses() : selectNoStatuses()}
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
            <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
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
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    Loading jobs...
                  </TableCell>
                </TableRow>
              ) : filteredJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    No jobs found
                  </TableCell>
                </TableRow>
              ) : (
                filteredJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    className={job.state === "failed" ? "bg-red-500/5 border-l-2 border-l-red-500" : ""}
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
                    <TableCell className="text-sm">
                      {formatDuration(job.processedOn, job.finishedOn)}
                    </TableCell>
                    <TableCell>
                      <JobProgressCell job={job} />
                    </TableCell>
                    <TableCell className="w-[80px] text-right p-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(job.id);
                              setCopiedId(job.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                            className="font-mono text-xs text-muted-foreground hover:text-foreground cursor-pointer inline-flex items-center gap-1"
                          >
                            <span className="truncate max-w-[50px]">{job.id.slice(-6)}</span>
                            {copiedId === job.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3 opacity-50" />
                            )}
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
