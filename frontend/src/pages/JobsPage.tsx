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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { JobInfo } from "@/types/jobs";
import { getToggledWorkerFilter } from "@/lib/jobFilters";
import { parseJobError } from "@/lib/jobs";
import { formatJobDuration } from "@/lib/jobDuration";

type WorkerStatus = {
  checkedAt: string;
  workers: Record<string, {
    paused: boolean;
    desiredConcurrency: number;
    effectiveConcurrency: number;
    minConcurrency: number;
    maxConcurrency: number;
    defaultTriggerIntervalSeconds?: number;
    triggerIntervalSeconds?: number;
    running: boolean;
    active: number;
    waiting: number;
    delayed: number;
    staleActive: number;
    staleClaims: number;
    staleJobs: Array<{
      id: string;
      createdAt?: string;
      startedAt?: string;
      updatedAt?: string;
      progress?: Record<string, any>;
    }>;
  }>;
};

type ExternalServiceHealth = {
  id: "stt" | "llm";
  label: string;
  status: "disabled" | "healthy" | "loading" | "unavailable" | "misconfigured";
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
  routes?: Array<{
    providerProfileId: string;
    providerProfileName: string;
    status:
      | "disabled"
      | "healthy"
      | "loading"
      | "unavailable"
      | "misconfigured";
    enabled: boolean;
    model?: string;
    priority: number;
    concurrency?: number;
    latencyMs?: number;
    message: string;
  }>;
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
  transcriptionRuntime: {
    configuredBatchSize: number;
    configuredTimeoutMinutes: number;
    activeBatch: {
      jobId?: string;
      updatedAt?: string;
      processedOn?: number;
      progress: Record<string, any>;
    } | null;
    recentBatches: Array<{
      jobId?: string;
      finishedAt?: string;
      batchSize?: number;
      processed?: number;
      sequences: Array<{
        sequenceId: string;
        sequenceStart?: string;
        audioPreparationMs?: number;
        prefetchWaitMs?: number;
        inferenceMs?: number;
        prefetched?: boolean;
      }>;
    }>;
  };
};

type ModelAlias = "small" | "medium" | "large";

// Job types whose work is served by the LLM routing chain. Their rows show
// the provider and alias → model, mirroring the STT provider sub-line.
const LLM_JOB_TYPES = new Set([
  "summarization",
  "conversation_chunk_creator",
  "conversation_extractor",
  "tagger",
]);

type JobInferenceUsage = {
  providerProfileId?: string;
  providerProfileName?: string;
  requestedModel?: string;
  resolvedModel?: string;
  // Model the provider itself reported, when it differs from the request.
  responseModel?: string;
  fallbackUsed?: boolean;
  failoverUsed?: boolean;
  calls?: number;
  mixed?: boolean;
  byProvider?: Array<{
    providerProfileId?: string;
    providerProfileName?: string;
    resolvedModel?: string;
    calls: number;
    fallback?: boolean;
  }>;
};
type LlmProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  aliases: Partial<Record<ModelAlias, string>>;
  defaultAlias: ModelAlias;
  chatModel?: string;
  enabled?: boolean;
  priority?: number;
  concurrency?: number;
};
type InferenceFilter = { kind: "provider" | "model" | "alias"; value: string };

// Every provider/model/alias name a job's routing data mentions, for the
// jobs-list inference filter. Covers actual usage (result/progress),
// per-provider breakdowns and the enqueue-time snapshot.
function getJobInferenceFacets(job: JobInfo): {
  providers: Set<string>;
  models: Set<string>;
  aliases: Set<string>;
} {
  const providers = new Set<string>();
  const models = new Set<string>();
  const aliases = new Set<string>();
  const isAlias = (value: string) =>
    value === "small" || value === "medium" || value === "large";

  // Jobs that already ran report what actually served them; facets must
  // reflect the executed route only, so filtering by a model never matches
  // jobs that merely *requested* it before falling back elsewhere.
  const usages = [
    job.result?.inference as JobInferenceUsage | undefined,
    job.progress?.inference as JobInferenceUsage | undefined,
  ].filter(Boolean) as JobInferenceUsage[];

  if (usages.length > 0) {
    for (const usage of usages) {
      if (usage.providerProfileName) providers.add(usage.providerProfileName);
      // The alias facet keeps what the task asked for; the model facet keeps
      // what actually ran (provider-reported name wins over the request).
      if (usage.requestedModel && isAlias(usage.requestedModel)) {
        aliases.add(usage.requestedModel);
      }
      const executed = usage.responseModel || usage.resolvedModel;
      if (executed && !isAlias(executed)) models.add(executed);
      for (const entry of usage.byProvider ?? []) {
        if (entry.providerProfileName) providers.add(entry.providerProfileName);
        if (entry.resolvedModel && !isAlias(entry.resolvedModel)) {
          models.add(entry.resolvedModel);
        }
      }
    }
    return { providers, models, aliases };
  }

  // Queued jobs have no execution record yet; fall back to the planned route
  // and the requested model.
  const addPlannedModel = (value?: string) => {
    if (!value) return;
    if (isAlias(value)) aliases.add(value);
    else models.add(value);
  };
  if (job.routingContext?.providerProfileName) {
    providers.add(job.routingContext.providerProfileName);
  }
  addPlannedModel(job.routingContext?.model);
  if (typeof job.data?.model === "string") addPlannedModel(job.data.model);
  return { providers, models, aliases };
}

type InferenceRoutingConfig = {
  llmProfiles?: {
    activeProfileId?: string;
    profiles: LlmProfile[];
    includeEnvironment?: boolean;
    environmentPriority?: number;
  } | null;
  transcription?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  } | null;
  transcriptionProfiles?: {
    profiles: Array<{
      id: string;
      name: string;
      model: string;
      enabled: boolean;
      concurrency: number;
      priority: number;
      baseUrl: string;
      apiKey: string;
    }>;
    includeEnvironment?: boolean;
    environmentPriority?: number;
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
    description: "Transcribes sequences through configured STT providers",
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
              <span>{result.audioDuration.toFixed(1)}s audio</span>
            )}
            {Number(result.inferenceMs) > 0 && result.audioDuration > 0 && (
              <span>
                {(result.inferenceMs / 1000).toFixed(1)}s STT · {(
                  result.audioDuration / (result.inferenceMs / 1000)
                ).toFixed(2)}× realtime
              </span>
            )}
            {result.wordCount != null
              ? <span>{result.wordCount} words</span>
              : <span className="opacity-50">— words</span>}
            {result.segmentCount != null && (
              <span>{result.segmentCount} segments</span>
            )}
            {result.batchSize != null && (
              <span>{result.processed ?? 0}/{result.batchSize} in batch</span>
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
        batch_starting: "Starting batch",
        idle: "Idle",
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
            {progress.batchSize != null && (
              <span>
                {progress.processedInBatch ?? 0}/{progress.batchSize} batch
              </span>
            )}
            {progress.prefetch?.state && (
              <span>
                prefetch {String(progress.prefetch.state).replaceAll("_", " ")}
              </span>
            )}
            {progress.audioPreparationMs != null && (
              <span>prep {progress.audioPreparationMs}ms</span>
            )}
            {progress.prefetchWaitMs != null && (
              <span>wait {progress.prefetchWaitMs}ms</span>
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
            className="bg-muted text-muted-foreground text-xs"
            title="Scheduled safety check found no unassigned transcriptions or stale chunks"
          >
            No work due
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
          {(result.chunksProcessed ?? 0) > 0 &&
              (result.conversationsCreated ?? 0) === 0 && (
            <Badge
              variant="secondary"
              className="bg-sky-500/10 text-sky-500 text-xs"
              title="The chunk was reviewed and saved as having no usable conversation"
            >
              Reviewed · no conversation
            </Badge>
          )}
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
      const batchSummaries = Array.isArray(result.summaries)
        ? result.summaries.filter((summary: any) => summary?.objectId)
        : [];
      if (batchSummaries.length > 0) {
        return (
          <div className="space-y-1">
            <Badge
              variant="secondary"
              className="bg-violet-500/10 text-violet-600 text-xs"
            >
              Batch summarization
            </Badge>
            <div className="text-xs text-muted-foreground">
              {batchSummaries.length}{" "}
              summar{batchSummaries.length === 1 ? "y" : "ies"} created
            </div>
            <Link
              to={`/jobs/${job.id}`}
              className="text-xs text-primary hover:underline"
            >
              view conversations
            </Link>
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
  const [selectedSttModel, setSelectedSttModel] = useState("");
  const [serviceTestResults, setServiceTestResults] = useState<
    Partial<Record<"stt" | "llm", string>>
  >({});
  const [inferenceFilter, setInferenceFilter] = useState<
    InferenceFilter | null
  >(null);
  const [inferenceFilterOpen, setInferenceFilterOpen] = useState(false);
  const [intervalDrafts, setIntervalDrafts] = useState<
    Record<string, string>
  >({});
  const [concurrencyDrafts, setConcurrencyDrafts] = useState<
    Record<string, string>
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
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!workerStatus?.workers) return;
    setConcurrencyDrafts((current) => {
      const next = { ...current };
      for (
        const [workerType, status] of Object.entries(
          workerStatus.workers,
        )
      ) {
        if (next[workerType] === undefined) {
          next[workerType] = String(status.desiredConcurrency);
        }
      }
      return next;
    });
    setIntervalDrafts((current) => {
      const next = { ...current };
      for (
        const [workerType, status] of Object.entries(
          workerStatus.workers,
        )
      ) {
        if (
          next[workerType] === undefined &&
          typeof status.triggerIntervalSeconds === "number"
        ) {
          next[workerType] = String(status.triggerIntervalSeconds);
        }
      }
      return next;
    });
  }, [workerStatus]);

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
    // Probe providers only from the explicit Refresh/Test actions. Continuous
    // polling wakes local Argmax servers through /v1/models.
    refetchInterval: false,
    staleTime: 15000,
  });

  const transcriptionModelByProfileId = useMemo(() => {
    const stt = pipelineHealth?.services.find((service) =>
      service.id === "stt"
    );
    return new Map(
      stt?.routes?.filter((route) => Boolean(route.model)).map((route) => [
        route.providerProfileId,
        route.model!,
      ]) ?? [],
    );
  }, [pipelineHealth]);

  const { data: inferenceRoutingConfig } = useQuery({
    queryKey: ["inference-routing-config"],
    queryFn: async () =>
      await api.callResource("config", {
        action: "get",
      }) as InferenceRoutingConfig,
  });

  useEffect(() => {
    const configuredSttModel = inferenceRoutingConfig?.transcription?.model;
    if (configuredSttModel) setSelectedSttModel(configuredSttModel);
  }, [inferenceRoutingConfig]);

  // Enabled profiles in failover order, for planned-route labels on queued
  // jobs. Providers advertising an explicit model outrank blind candidates.
  const llmRoutingProfiles = useMemo(
    () =>
      (inferenceRoutingConfig?.llmProfiles?.profiles ?? [])
        .filter((profile) => profile.enabled ?? true)
        .sort((a, b) =>
          (a.priority ?? 50) - (b.priority ?? 50) ||
          a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
        ),
    [inferenceRoutingConfig],
  );

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

  const refreshWorkerViews = () => {
    refetchWorkerStatus();
    refetchPipelineHealth();
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["job-stats"] });
  };

  const pauseWorkerMutation = useMutation({
    mutationFn: async (workerType: string) => {
      await api.callResource("jobs", {
        action: "pause_worker",
        workerType,
      });
    },
    onSettled: refreshWorkerViews,
    onError: (error) =>
      alert(error instanceof Error ? error.message : "Failed to pause worker"),
  });

  const resumeWorkerMutation = useMutation({
    mutationFn: async (workerType: string) => {
      await api.callResource("jobs", {
        action: "resume_worker",
        workerType,
      });
    },
    onSettled: refreshWorkerViews,
    onError: (error) =>
      alert(error instanceof Error ? error.message : "Failed to resume worker"),
  });

  const pauseAllMutation = useMutation({
    mutationFn: async () => {
      await api.callResource("jobs", {
        action: "pause_all",
      });
    },
    onSettled: refreshWorkerViews,
    onError: (error) =>
      alert(error instanceof Error ? error.message : "Failed to pause workers"),
  });

  const resumeAllMutation = useMutation({
    mutationFn: async () => {
      await api.callResource("jobs", {
        action: "resume_all",
      });
    },
    onSettled: refreshWorkerViews,
    onError: (error) =>
      alert(
        error instanceof Error ? error.message : "Failed to resume workers",
      ),
  });

  const setWorkerIntervalMutation = useMutation({
    mutationFn: async (
      { workerType, seconds }: { workerType: string; seconds: number },
    ) => {
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
        throw new Error("Interval must be an integer between 0 and 86400");
      }
      await api.callResource("config", {
        action: "patch",
        path: `workers.${workerType}`,
        updates: { triggerIntervalSeconds: seconds },
      });
      return { workerType, seconds };
    },
    onSuccess: ({ workerType, seconds }) => {
      setIntervalDrafts((current) => ({
        ...current,
        [workerType]: String(seconds),
      }));
      queryClient.invalidateQueries({ queryKey: ["worker-status"] });
    },
    onError: (error) => {
      alert(
        error instanceof Error ? error.message : "Failed to save interval",
      );
    },
  });

  const setWorkerConcurrencyMutation = useMutation({
    mutationFn: async ({
      workerType,
      concurrency,
    }: {
      workerType: string;
      concurrency: number;
    }) =>
      await api.callResource("jobs", {
        action: "set_worker_concurrency",
        workerType,
        concurrency,
      }) as {
        workerType: string;
        desiredConcurrency: number;
        effectiveConcurrency: number;
      },
    onSuccess: (result) => {
      setConcurrencyDrafts((current) => ({
        ...current,
        [result.workerType]: String(result.desiredConcurrency),
      }));
    },
    onSettled: refreshWorkerViews,
    onError: (error) =>
      alert(
        error instanceof Error ? error.message : "Failed to set concurrency",
      ),
  });

  const restartJobMutation = useMutation({
    mutationFn: async (jobId: string) =>
      await api.callResource("jobs", {
        action: "restart_job",
        id: jobId,
      }) as { originalJobId: string; restartedJobId: string },
    onSuccess: (result) =>
      alert(
        `Restarted ${result.originalJobId.slice(-6)} as ` +
          result.restartedJobId.slice(-6),
      ),
    onSettled: refreshWorkerViews,
    onError: (error) =>
      alert(error instanceof Error ? error.message : "Failed to restart job"),
  });

  const forceStartMutation = useMutation({
    mutationFn: async ({
      workerType,
      count,
    }: {
      workerType: string;
      count: number;
    }) =>
      await api.callResource("jobs", {
        action: "force_start",
        workerType,
        count,
      }) as { workerType: string; startedCount: number },
    onSuccess: (result) =>
      alert(`Started ${result.startedCount} ${result.workerType} job(s).`),
    onSettled: refreshWorkerViews,
    onError: (error) =>
      alert(error instanceof Error ? error.message : "Failed to start jobs"),
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
        data: {
          type: workerType,
          retryNow: workerType === "conversation_extractor" ||
            workerType === "summarization",
        },
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
    mutationFn: async ({
      workerType,
      failedCount,
    }: {
      workerType: string;
      failedCount: number;
    }) => {
      let retriedCount = 0;
      let dismissedCount = 0;
      let handledCount = 0;
      let queuedCount = 0;
      let errors: string[] = [];

      while (handledCount < failedCount) {
        const batchSize = Math.min(100, failedCount - handledCount);
        const result = await api.callResource("jobs", {
          action: "retry_failed",
          workerType,
          limit: batchSize,
        }) as {
          retriedCount: number;
          dismissedCount?: number;
          handledCount?: number;
          queuedCount?: number;
          workerType: string;
          errors?: string[];
        };

        retriedCount += result.retriedCount;
        dismissedCount += result.dismissedCount ?? 0;
        const batchHandled = result.handledCount ?? result.retriedCount;
        handledCount += batchHandled;
        queuedCount += result.queuedCount ?? result.retriedCount;
        errors = result.errors ?? [];
        if (errors.length > 0 || batchHandled < batchSize) break;
      }

      return {
        retriedCount,
        dismissedCount,
        handledCount,
        queuedCount,
        workerType,
        errors,
      };
    },
    onSuccess: (result) => {
      alert(
        result.handledCount > 0
          ? `Handled ${result.handledCount} failed ${result.workerType} job(s): queued ${result.queuedCount} recovery job(s) and dismissed ${result.dismissedCount} superseded failure(s). The original records remain in history.${
            result.errors.length > 0
              ? `\n\nStopped early: ${result.errors[0]}`
              : ""
          }`
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

  const dismissFailedMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return await api.callResource("jobs", {
        action: "dismiss_failed",
        id: jobId,
        reason: "user_dismissed_obsolete_failure",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job-stats"] });
      refetchPipelineHealth();
    },
    onError: (error) => {
      alert(
        error instanceof Error ? error.message : "Failed to dismiss failure",
      );
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

  const setLlmRouteEnabledMutation = useMutation({
    mutationFn: async ({ profileId, enabled }: {
      profileId: string;
      enabled: boolean;
    }) => {
      const config = await api.callResource("config", {
        action: "get",
      }) as InferenceRoutingConfig;
      const llmProfiles = config.llmProfiles;
      if (!llmProfiles?.profiles?.length) {
        throw new Error("No LLM provider profiles are configured");
      }
      if (profileId === "environment") {
        await api.callResource("config", {
          action: "patch",
          updates: {
            llmProfiles: { ...llmProfiles, includeEnvironment: enabled },
          },
        });
      } else {
        if (!llmProfiles.profiles.some((profile) => profile.id === profileId)) {
          throw new Error("LLM route no longer exists");
        }
        await api.callResource("config", {
          action: "patch",
          updates: {
            llmProfiles: {
              ...llmProfiles,
              profiles: llmProfiles.profiles.map((profile) =>
                profile.id === profileId ? { ...profile, enabled } : profile
              ),
            },
          },
        });
      }
      return enabled
        ? await api.callResource("jobs", {
          action: "pipeline_health",
          force: true,
        }) as PipelineHealth
        : null;
    },
    onSuccess: (health, { profileId, enabled }) => {
      queryClient.invalidateQueries({ queryKey: ["inference-routing-config"] });
      if (health) {
        queryClient.setQueryData(["pipeline-health"], health);
      } else {
        queryClient.setQueryData<PipelineHealth | undefined>(
          ["pipeline-health"],
          (current) =>
            current
              ? {
                ...current,
                services: current.services.map((service) =>
                  service.id !== "llm" || !service.routes ? service : {
                    ...service,
                    routes: service.routes.map((route) =>
                      route.providerProfileId === profileId
                        ? {
                          ...route,
                          enabled,
                          status: "disabled",
                          message:
                            "Disabled for new LLM requests; no health probe was sent.",
                        }
                        : route
                    ),
                  }
                ),
              }
              : current,
        );
      }
    },
    onError: (error) => {
      setServiceTestResults((current) => ({
        ...current,
        llm: error instanceof Error
          ? error.message
          : "Failed to update LLM route",
      }));
    },
  });

  const makeLlmPrimaryMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const config = await api.callResource("config", {
        action: "get",
      }) as InferenceRoutingConfig;
      const llmProfiles = config.llmProfiles;
      if (!llmProfiles?.profiles?.length) {
        throw new Error("No LLM provider profiles are configured");
      }
      const otherPriorities = [
        ...llmProfiles.profiles
          .filter((profile) => profile.id !== profileId)
          .map((profile) => profile.priority ?? 50),
        ...(profileId !== "environment" && llmProfiles.includeEnvironment
          ? [llmProfiles.environmentPriority ?? 50]
          : []),
      ];
      const topPriority = Math.max(
        1,
        Math.min(50, ...otherPriorities) - 1,
      );
      if (profileId === "environment") {
        await api.callResource("config", {
          action: "patch",
          updates: {
            llmProfiles: {
              ...llmProfiles,
              includeEnvironment: true,
              environmentPriority: topPriority,
            },
          },
        });
      } else {
        const profile = llmProfiles.profiles.find((candidate) =>
          candidate.id === profileId
        );
        if (!profile) throw new Error("LLM route no longer exists");
        await api.callResource("config", {
          action: "patch",
          updates: {
            llmProfiles: {
              ...llmProfiles,
              // Deprecated but kept in sync for older builds during rollback.
              activeProfileId: profileId,
              profiles: llmProfiles.profiles.map((candidate) =>
                candidate.id === profileId
                  ? { ...candidate, enabled: true, priority: topPriority }
                  : candidate
              ),
            },
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inference-routing-config"] });
      refetchPipelineHealth();
      setServiceTestResults((current) => ({
        ...current,
        llm: "Route promoted. New LLM requests prefer it.",
      }));
    },
    onError: (error) => {
      setServiceTestResults((current) => ({
        ...current,
        llm: error instanceof Error
          ? error.message
          : "Failed to promote LLM route",
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

  const setSttRouteEnabledMutation = useMutation({
    mutationFn: async ({ profileId, enabled }: {
      profileId: string;
      enabled: boolean;
    }) => {
      const config = await api.callResource("config", {
        action: "get",
      }) as InferenceRoutingConfig;
      const profiles = config.transcriptionProfiles?.profiles ?? [];
      if (!profiles.some((profile) => profile.id === profileId)) {
        throw new Error("STT route no longer exists");
      }
      await api.callResource("config", {
        action: "patch",
        updates: {
          transcriptionProfiles: {
            profiles: profiles.map((profile) =>
              profile.id === profileId ? { ...profile, enabled } : profile
            ),
            includeEnvironment:
              config.transcriptionProfiles?.includeEnvironment ?? false,
            environmentPriority:
              config.transcriptionProfiles?.environmentPriority ?? 50,
          },
        },
      });
      // An explicit enable is the one time we immediately wake this server to
      // confirm it came back. Disabling does not probe the server.
      return enabled
        ? await api.callResource("jobs", {
          action: "pipeline_health",
          force: true,
        }) as PipelineHealth
        : null;
    },
    onSuccess: (health, { profileId, enabled }) => {
      queryClient.invalidateQueries({ queryKey: ["inference-routing-config"] });
      if (health) {
        queryClient.setQueryData(["pipeline-health"], health);
      } else {
        queryClient.setQueryData<PipelineHealth | undefined>(
          ["pipeline-health"],
          (current) =>
            current
              ? {
                ...current,
                services: current.services.map((service) =>
                  service.id !== "stt" || !service.routes ? service : {
                    ...service,
                    routes: service.routes.map((route) =>
                      route.providerProfileId === profileId
                        ? {
                          ...route,
                          enabled,
                          status: "disabled",
                          message:
                            "Disabled for new transcription jobs; no health probe was sent.",
                        }
                        : route
                    ),
                  }
                ),
              }
              : current,
        );
      }
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

  // Facet options for the inference filter, with occurrence counts across
  // the currently loaded jobs.
  const inferenceFilterOptions = useMemo(() => {
    const providers = new Map<string, number>();
    const models = new Map<string, number>();
    const aliases = new Map<string, number>();
    for (const job of jobs) {
      const facets = getJobInferenceFacets(job);
      for (const name of facets.providers) {
        providers.set(name, (providers.get(name) ?? 0) + 1);
      }
      for (const name of facets.models) {
        models.set(name, (models.get(name) ?? 0) + 1);
      }
      for (const name of facets.aliases) {
        aliases.set(name, (aliases.get(name) ?? 0) + 1);
      }
    }
    const sorted = (map: Map<string, number>) =>
      [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      providers: sorted(providers),
      models: sorted(models),
      aliases: sorted(aliases),
    };
  }, [jobs]);

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

    // Apply inference (provider/model/alias) filter
    if (inferenceFilter) {
      result = result.filter((job) => {
        const facets = getJobInferenceFacets(job);
        if (inferenceFilter.kind === "provider") {
          return facets.providers.has(inferenceFilter.value);
        }
        if (inferenceFilter.kind === "alias") {
          return facets.aliases.has(inferenceFilter.value);
        }
        return facets.models.has(inferenceFilter.value);
      });
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
    inferenceFilter,
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

  const toggleOnlyType = (type: string) => {
    const next = getToggledWorkerFilter(
      allTypesSelected,
      filterTypes,
      type,
    );
    setAllTypesSelected(next.allSelected);
    setFilterTypes(next.selectedTypes);
    syncTypeToUrl(next.selectedTypes, next.allSelected);
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
      inferenceFilter !== null ||
      hideEmpty
    );
  }, [
    quickFilter,
    allTypesSelected,
    filterStatuses.size,
    searchQuery,
    inferenceFilter,
    hideEmpty,
    ALL_STATUSES.length,
  ]);

  // Toggle the inference filter; clicking the same value clears it.
  const toggleInferenceFilter = (
    kind: InferenceFilter["kind"],
    value: string | undefined,
  ) => {
    if (!value) return;
    setInferenceFilter((current) =>
      current && current.kind === kind && current.value === value
        ? null
        : { kind, value }
    );
  };

  // Clickable facet in a job row's routing sub-line; clicking toggles the
  // inference filter (mirrors clicking a worker type to filter by it).
  const inferenceChip = (
    kind: InferenceFilter["kind"],
    value: string | undefined,
    label?: string,
  ) =>
    value
      ? (
        <span
          className="cursor-pointer hover:text-primary hover:underline"
          title={`Filter jobs by ${kind}: ${value}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleInferenceFilter(kind, value);
          }}
        >
          {label ?? value}
        </span>
      )
      : null;

  const modelChip = (value: string | undefined, label?: string) =>
    inferenceChip(
      value === "small" || value === "medium" || value === "large"
        ? "alias"
        : "model",
      value,
      label,
    );

  // Clear all filters
  const clearFilters = () => {
    setQuickFilter("all");
    setAllTypesSelected(true);
    setFilterTypes(new Set());
    setFilterStatuses(new Set(ALL_STATUSES));
    setSearchQuery("");
    setInferenceFilter(null);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("type");
    newParams.delete("hideEmpty");
    setSearchParams(newParams);
  };

  const getTypesLabel = () => {
    if (allTypesSelected) return "All workers";
    if (filterTypes.size === 0) return "No workers";
    if (filterTypes.size === 1) return Array.from(filterTypes)[0];
    return `${filterTypes.size} workers`;
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
            disabled={resumeAllMutation.isPending ||
              pauseAllMutation.isPending ||
              !somePaused}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            {resumeAllMutation.isPending ? "Resuming…" : "Resume All"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => pauseAllMutation.mutate()}
            disabled={pauseAllMutation.isPending ||
              resumeAllMutation.isPending ||
              allPaused === true}
          >
            <PauseCircle className="h-4 w-4 mr-2" />
            {pauseAllMutation.isPending ? "Pausing…" : "Pause All"}
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
                          {service.routes?.length
                            ? (
                              <>
                                <Label className="text-xs">
                                  Provider-aware LLM routes
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  Requests use the highest-priority enabled
                                  route and fail over down the list on errors.
                                </p>
                                <div className="space-y-1">
                                  {service.routes.map((route) => (
                                    <div
                                      key={route.providerProfileId}
                                      className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-2 text-xs"
                                    >
                                      <div className="flex min-w-0 items-center gap-2">
                                        <Switch
                                          checked={route.enabled}
                                          disabled={setLlmRouteEnabledMutation
                                            .isPending}
                                          onCheckedChange={(enabled) =>
                                            setLlmRouteEnabledMutation.mutate({
                                              profileId:
                                                route.providerProfileId,
                                              enabled,
                                            })}
                                          aria-label={`Enable ${route.providerProfileName} LLM route`}
                                        />
                                        <div className="min-w-0">
                                          <div className="truncate font-medium">
                                            {route.providerProfileName}
                                          </div>
                                          <div className="text-muted-foreground">
                                            {route.enabled
                                              ? "Enabled for new requests"
                                              : "Disabled for new requests"}
                                          </div>
                                        </div>
                                      </div>
                                      <span className="font-mono text-muted-foreground">
                                        P{route.priority} ·{" "}
                                        {route.model || "unknown"}
                                        {typeof route.concurrency === "number"
                                          ? ` · ${route.concurrency} req${
                                            route.concurrency === 1 ? "" : "s"
                                          }`
                                          : ""}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() =>
                                            makeLlmPrimaryMutation.mutate(
                                              route.providerProfileId,
                                            )}
                                          disabled={makeLlmPrimaryMutation
                                            .isPending}
                                          title="Give this route the highest priority"
                                        >
                                          Make primary
                                        </Button>
                                        <Badge
                                          variant="secondary"
                                          className={route.status === "disabled"
                                            ? "bg-muted text-muted-foreground"
                                            : undefined}
                                        >
                                          {route.status}
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )
                            : (
                              <p className="text-xs text-muted-foreground">
                                No LLM provider routes are configured yet.
                              </p>
                            )}
                          <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm" variant="outline">
                              <Link to="/settings/inference">
                                Configure LLM providers
                              </Link>
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
                        </div>
                      )}

                      {service.id === "stt" && (
                        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                          {service.routes?.length
                            ? (
                              <>
                                <Label className="text-xs">
                                  Provider-aware transcription routes
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  The toggle controls Mycelia routing for new
                                  jobs; it does not stop the server process.
                                </p>
                                <div className="space-y-1">
                                  {service.routes.map((route) => (
                                    <div
                                      key={route.providerProfileId}
                                      className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-2 text-xs"
                                    >
                                      <div className="flex min-w-0 items-center gap-2">
                                        <Switch
                                          checked={route.enabled}
                                          disabled={setSttRouteEnabledMutation
                                            .isPending}
                                          onCheckedChange={(enabled) =>
                                            setSttRouteEnabledMutation.mutate({
                                              profileId:
                                                route.providerProfileId,
                                              enabled,
                                            })}
                                          aria-label={`Enable ${route.providerProfileName} STT route`}
                                        />
                                        <div className="min-w-0">
                                          <div className="truncate font-medium">
                                            {route.providerProfileName}
                                          </div>
                                          <div className="text-muted-foreground">
                                            {route.enabled
                                              ? "Enabled for new jobs"
                                              : "Disabled for new jobs"}
                                          </div>
                                        </div>
                                      </div>
                                      <span className="font-mono text-muted-foreground">
                                        P{route.priority} ·{" "}
                                        {route.model || "unknown"} ·{" "}
                                        {route.concurrency}{" "}
                                        slot{route.concurrency ===
                                            1
                                          ? ""
                                          : "s"}
                                      </span>
                                      <Badge
                                        variant="secondary"
                                        className={route.status === "disabled"
                                          ? "bg-muted text-muted-foreground"
                                          : undefined}
                                      >
                                        {route.status}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                                <Button asChild size="sm" variant="outline">
                                  <Link to="/settings/speech-to-text">
                                    Configure STT providers
                                  </Link>
                                </Button>
                              </>
                            )
                            : (
                              <>
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
                                      saveSttModelMutation.mutate(
                                        selectedSttModel,
                                      )}
                                    disabled={!selectedSttModel ||
                                      saveSttModelMutation.isPending}
                                  >
                                    <Save className="mr-2 h-3.5 w-3.5" />
                                    Save model
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      testServiceMutation.mutate("stt")}
                                    disabled={testServiceMutation.isPending}
                                  >
                                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                    Test & load models
                                  </Button>
                                </div>
                              </>
                            )}
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
                  const availableWork = backlog.ready +
                    (backlog.retryableErrors ?? 0);
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
                          disabled={!runnable || availableWork === 0 ||
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
                          onClick={() => {
                            if (
                              window.confirm(
                                `Retry all ${backlog.failedJobsUnretried} failed ${workerType} job(s)? Completed sources will be dismissed; unfinished sources will be queued with the current configuration.`,
                              )
                            ) {
                              retryFailedMutation.mutate({
                                workerType,
                                failedCount: backlog.failedJobsUnretried,
                              });
                            }
                          }}
                          disabled={service?.status !== "healthy" ||
                            backlog.failedJobsUnretried === 0 ||
                            retryFailedMutation.isPending}
                        >
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          Retry all failed ({backlog.failedJobsUnretried})
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
                    <TableHead className="w-[105px]">Actions</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead className="text-center w-[145px]">
                      Concurrency
                    </TableHead>
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
                    <TableHead className="w-[120px]">Schedule</TableHead>
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
                    const runtime = workerStatus?.workers[worker.type];
                    const liveJobs = (runtime?.active ?? 0) +
                      (runtime?.waiting ?? 0) + (runtime?.delayed ?? 0);
                    const forceStartSlots = isPaused ? 0 : Math.max(
                      0,
                      (runtime?.effectiveConcurrency ?? 1) - liveJobs,
                    );
                    return (
                      <TableRow
                        key={worker.type}
                        className={`h-9 ${isPaused ? "bg-amber-500/5" : ""} ${
                          !allTypesSelected && filterTypes.size === 1 &&
                            filterTypes.has(worker.type)
                            ? "ring-1 ring-inset ring-primary/30"
                            : ""
                        }`}
                      >
                        <TableCell className="pl-4 py-1">
                          <Checkbox
                            checked={!isPaused}
                            onCheckedChange={() =>
                              handleToggleWorker(worker.type, isPaused)}
                            disabled={isMutating}
                            className="cursor-pointer"
                            aria-label={`${worker.type} enabled`}
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
                                    aria-label={`Run ${worker.type} job`}
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
                                  aria-label={`Clear ${worker.type} queue`}
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
                            <DropdownMenu>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      disabled={restartJobMutation.isPending ||
                                        forceStartMutation.isPending ||
                                        resetWorkerMutation.isPending}
                                      aria-label={`Recovery actions for ${worker.type}`}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Restart stale or force start
                                </TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent align="end" className="w-72">
                                {runtime?.staleJobs?.length
                                  ? runtime.staleJobs.map((staleJob) => (
                                    <DropdownMenuItem
                                      key={staleJob.id}
                                      onClick={() => {
                                        if (
                                          confirm(
                                            `Restart stale ${worker.type} job ${staleJob.id}? The original job will remain in history.`,
                                          )
                                        ) {
                                          restartJobMutation.mutate(
                                            staleJob.id,
                                          );
                                        }
                                      }}
                                    >
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      Restart stale job …{staleJob.id.slice(-6)}
                                    </DropdownMenuItem>
                                  ))
                                  : (
                                    <DropdownMenuItem disabled>
                                      No stale active jobs
                                    </DropdownMenuItem>
                                  )}
                                <DropdownMenuSeparator />
                                {forceStartSlots > 0
                                  ? Array.from(
                                    { length: forceStartSlots },
                                    (_, index) => index + 1,
                                  ).map((count) => (
                                    <DropdownMenuItem
                                      key={count}
                                      onClick={() =>
                                        forceStartMutation.mutate({
                                          workerType: worker.type,
                                          count,
                                        })}
                                    >
                                      <PlayCircle className="mr-2 h-4 w-4" />
                                      Force start {count}{" "}
                                      job{count > 1 ? "s" : ""}
                                    </DropdownMenuItem>
                                  ))
                                  : (
                                    <DropdownMenuItem disabled>
                                      {isPaused
                                        ? "Resume worker before force start"
                                        : "No free concurrency slots"}
                                    </DropdownMenuItem>
                                  )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() =>
                                    handleResetWorker(
                                      worker.type,
                                      stats?.active ?? 0,
                                      stats?.waiting ?? 0,
                                      stats?.delayed ?? 0,
                                      stats?.staleClaims ?? 0,
                                    )}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Danger: reset entire worker
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                        <TableCell className="py-1">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-left hover:text-primary"
                            onClick={() => toggleOnlyType(worker.type)}
                            title={!allTypesSelected &&
                                filterTypes.size === 1 &&
                                filterTypes.has(worker.type)
                              ? "Show all workers"
                              : `Show only ${worker.type} jobs`}
                          >
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
                          </button>
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex items-center justify-center gap-1">
                            <Input
                              type="number"
                              min={runtime?.minConcurrency ?? 1}
                              max={runtime?.maxConcurrency ?? 8}
                              value={concurrencyDrafts[worker.type] ??
                                String(runtime?.desiredConcurrency ?? 1)}
                              onChange={(event) =>
                                setConcurrencyDrafts((current) => ({
                                  ...current,
                                  [worker.type]: event.target.value,
                                }))}
                              className="h-7 w-14 px-2 text-center"
                              aria-label={`${worker.type} desired concurrency`}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={setWorkerConcurrencyMutation
                                .isPending ||
                                Number(
                                    concurrencyDrafts[worker.type] ??
                                      runtime?.desiredConcurrency ?? 1,
                                  ) ===
                                  (runtime?.desiredConcurrency ?? 1)}
                              onClick={() =>
                                setWorkerConcurrencyMutation.mutate({
                                  workerType: worker.type,
                                  concurrency: Number(
                                    concurrencyDrafts[worker.type],
                                  ),
                                })}
                              title="Save and apply concurrency"
                            >
                              <Save className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="text-center text-[10px] text-muted-foreground">
                            {setWorkerConcurrencyMutation.isPending &&
                                setWorkerConcurrencyMutation.variables
                                    ?.workerType === worker.type
                              ? "applying…"
                              : `effective ${
                                runtime?.effectiveConcurrency ?? "—"
                              }`}
                            {runtime && runtime.desiredConcurrency !==
                                runtime.effectiveConcurrency &&
                              ` · desired ${runtime.desiredConcurrency}`}
                            {worker.type === "transcription" &&
                              ` · batch ${
                                pipelineHealth?.transcriptionRuntime
                                  .configuredBatchSize ?? "—"
                              }`}
                            {runtime &&
                              ` · allowed ${runtime.minConcurrency}–${runtime.maxConcurrency}`}
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
                        <TableCell className="py-1">
                          {typeof runtime?.defaultTriggerIntervalSeconds ===
                              "number"
                            ? (
                              <>
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    min={0}
                                    max={86400}
                                    value={intervalDrafts[worker.type] ??
                                      String(
                                        runtime?.triggerIntervalSeconds ?? "",
                                      )}
                                    onChange={(event) =>
                                      setIntervalDrafts((current) => ({
                                        ...current,
                                        [worker.type]: event.target.value,
                                      }))}
                                    className="h-7 w-16 px-2 text-center"
                                    aria-label={`${worker.type} scheduled-run interval in seconds`}
                                    title="Scheduled-run interval in seconds; 0 disables scheduled runs (event triggers still fire)"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    disabled={setWorkerIntervalMutation
                                      .isPending ||
                                      Number(
                                          intervalDrafts[worker.type] ??
                                            runtime?.triggerIntervalSeconds ??
                                            NaN,
                                        ) ===
                                        (runtime?.triggerIntervalSeconds ??
                                          NaN)}
                                    onClick={() =>
                                      setWorkerIntervalMutation.mutate({
                                        workerType: worker.type,
                                        seconds: Number(
                                          intervalDrafts[worker.type],
                                        ),
                                      })}
                                    title="Save schedule interval"
                                  >
                                    <Save className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {Number(
                                        intervalDrafts[worker.type] ??
                                          runtime?.triggerIntervalSeconds ?? 1,
                                      ) === 0
                                    ? "schedule off"
                                    : `every ${
                                      intervalDrafts[worker.type] ??
                                        runtime?.triggerIntervalSeconds
                                    }s`}
                                  {` · runs ${stats?.avgFrequency ?? "-"}`}
                                </div>
                              </>
                            )
                            : (
                              <span className="text-sm text-muted-foreground">
                                {stats?.avgFrequency ?? "-"}
                              </span>
                            )}
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
                placeholder="Search by ID or worker..."
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
                  All workers
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

            <Popover
              open={inferenceFilterOpen}
              onOpenChange={setInferenceFilterOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-[230px] justify-between"
                  title="Filter jobs by LLM provider, model or alias"
                >
                  <span className="truncate">
                    {inferenceFilter
                      ? `${inferenceFilter.kind}: ${inferenceFilter.value}`
                      : "Provider / model"}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[320px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search provider, model or alias…" />
                  <CommandList>
                    <CommandEmpty>Nothing matches.</CommandEmpty>
                    {inferenceFilter && (
                      <CommandGroup>
                        <CommandItem
                          value="__clear"
                          onSelect={() => {
                            setInferenceFilter(null);
                            setInferenceFilterOpen(false);
                          }}
                        >
                          Clear filter ({inferenceFilter.kind}:{" "}
                          {inferenceFilter.value})
                        </CommandItem>
                      </CommandGroup>
                    )}
                    {inferenceFilterOptions.providers.length > 0 && (
                      <CommandGroup heading="Providers">
                        {inferenceFilterOptions.providers.map((
                          [name, count],
                        ) => (
                          <CommandItem
                            key={`provider-${name}`}
                            value={`provider ${name}`}
                            onSelect={() => {
                              toggleInferenceFilter("provider", name);
                              setInferenceFilterOpen(false);
                            }}
                          >
                            <span className="truncate">{name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {count}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {inferenceFilterOptions.aliases.length > 0 && (
                      <CommandGroup heading="Aliases">
                        {inferenceFilterOptions.aliases.map(([name, count]) => (
                          <CommandItem
                            key={`alias-${name}`}
                            value={`alias ${name}`}
                            onSelect={() => {
                              toggleInferenceFilter("alias", name);
                              setInferenceFilterOpen(false);
                            }}
                          >
                            <span className="truncate">{name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {count}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {inferenceFilterOptions.models.length > 0 && (
                      <CommandGroup heading="Models">
                        {inferenceFilterOptions.models.map(([name, count]) => (
                          <CommandItem
                            key={`model-${name}`}
                            value={`model ${name}`}
                            onSelect={() => {
                              toggleInferenceFilter("model", name);
                              setInferenceFilterOpen(false);
                            }}
                          >
                            <span className="truncate">{name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {count}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

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
                        onClick={() => toggleOnlyType(job.type)}
                        title={!allTypesSelected && filterTypes.size === 1 &&
                            filterTypes.has(job.type)
                          ? "Show all workers"
                          : `Filter by ${job.type}`}
                      >
                        <div>
                          {job.type === "summarization" &&
                              (Array.isArray(job.result?.summaries) &&
                                  job.result.summaries.length > 0 ||
                                (job.result?.skipped ?? 0) > 0)
                            ? `Batch summarization · ${
                              job.result?.summaries?.length ?? 0
                            }${
                              (job.result?.skipped ?? 0) > 0
                                ? ` (+${job.result.skipped} skipped)`
                                : ""
                            }`
                            : job.type}
                        </div>
                        {job.type === "transcription" &&
                          job.routingContext?.providerProfileName && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {job.routingContext.providerProfileName}
                            {job.routingContext.model ||
                              transcriptionModelByProfileId.get(
                                job.routingContext.providerProfileId || "",
                              )
                              ? ` · ${
                                job.routingContext.model ||
                                  transcriptionModelByProfileId.get(
                                    job.routingContext.providerProfileId || "",
                                  )
                              }`
                              : ""}
                          </div>
                        )}
                        {LLM_JOB_TYPES.has(job.type) && (() => {
                          // Completed jobs report the provider and model that
                          // actually served them; active jobs stream their
                          // current route through progress; queued jobs show
                          // the route expected to serve the request.
                          // Chunk-creator jobs make no LLM calls themselves —
                          // they only snapshot the model for extraction.
                          const isSnapshotOnly =
                            job.type === "conversation_chunk_creator";
                          const inference = (job.result?.inference ??
                            job.progress?.inference) as
                              | JobInferenceUsage
                              | undefined;
                          const isCompleted = Boolean(job.result?.inference);
                          if (
                            inference?.mixed && inference.byProvider
                          ) {
                            // Calls were served by several provider/model
                            // groups; show the breakdown with per-group
                            // fallback markers, every part clickable.
                            return (
                              <div
                                className="text-[10px] font-normal text-muted-foreground"
                                title="Calls in this job were served by several routes (saturated routes overflow by priority; failed models retry on their fallback)"
                              >
                                {inference.byProvider.map((entry, index) => (
                                  <span key={index}>
                                    {index > 0 ? " + " : ""}
                                    {inferenceChip(
                                      "provider",
                                      entry.providerProfileName ||
                                        entry.providerProfileId,
                                    )}
                                    {` ×${entry.calls}`}
                                    {entry.resolvedModel && (
                                      <>
                                        {" ("}
                                        {modelChip(entry.resolvedModel)}
                                        {entry.fallback ? ", fallback" : ""}
                                        {")"}
                                      </>
                                    )}
                                  </span>
                                ))}
                              </div>
                            );
                          }
                          if (
                            inference?.resolvedModel ||
                            inference?.providerProfileName
                          ) {
                            const requested = inference.requestedModel;
                            const resolved = inference.resolvedModel;
                            const served = inference.responseModel;
                            if (isCompleted) {
                              // Completed jobs show only what actually ran:
                              // the executed model, with a fallback marker
                              // when the whole job ran on the fallback.
                              return (
                                <div
                                  className="text-[10px] font-normal text-muted-foreground"
                                  title="LLM provider and model that served this job"
                                >
                                  {inferenceChip(
                                    "provider",
                                    inference.providerProfileName ||
                                      inference.providerProfileId,
                                  )}
                                  {" · "}
                                  {modelChip(resolved || requested)}
                                  {inference.fallbackUsed ? " (fallback)" : ""}
                                  {served && resolved && served !== resolved &&
                                    (
                                      <>
                                        {" (served "}
                                        {modelChip(served)}
                                        {")"}
                                      </>
                                    )}
                                </div>
                              );
                            }
                            // Active jobs keep the requested → resolved
                            // notation streamed through progress.
                            return (
                              <div
                                className="text-[10px] font-normal text-muted-foreground"
                                title="LLM provider and model currently serving this job"
                              >
                                {inferenceChip(
                                  "provider",
                                  inference.providerProfileName ||
                                    inference.providerProfileId,
                                )}
                                {" · "}
                                {requested && resolved &&
                                    requested !== resolved
                                  ? (
                                    <>
                                      {/* Only aliases stay clickable on the
                                          requested side: the model filter
                                          matches executed models, and a
                                          fallen-back request never executed. */}
                                      {requested === "small" ||
                                          requested === "medium" ||
                                          requested === "large"
                                        ? modelChip(requested)
                                        : requested}
                                      {" → "}
                                      {modelChip(resolved)}
                                    </>
                                  )
                                  : modelChip(resolved || requested)}
                                {inference.fallbackUsed ? " · fallback" : ""}
                                {inference.failoverUsed ? " · failover" : ""}
                              </div>
                            );
                          }
                          const context = job.routingContext;
                          const requested =
                            (typeof job.data?.model === "string" &&
                              job.data.model) ||
                            context?.model;
                          if (!context?.providerProfileName && !requested) {
                            return null;
                          }
                          // Pick the route expected to serve this model:
                          // providers advertising an explicit model outrank
                          // blind candidates; aliases go to the first provider
                          // mapping them.
                          const isAlias = requested === "small" ||
                            requested === "medium" || requested === "large";
                          const planned = requested
                            ? (isAlias
                              ? llmRoutingProfiles.find((profile) =>
                                profile.aliases[requested as ModelAlias]
                              )
                              : llmRoutingProfiles.find((profile) =>
                                Object.values(profile.aliases).includes(
                                  requested,
                                ) || profile.chatModel === requested
                              ) ?? llmRoutingProfiles[0])
                            : llmRoutingProfiles.find((profile) =>
                              profile.id === context?.providerProfileId
                            );
                          const resolved = requested && isAlias
                            ? planned?.aliases[requested as ModelAlias]
                            : undefined;
                          if (isSnapshotOnly) {
                            return (
                              <div
                                className="text-[10px] font-normal text-muted-foreground"
                                title="Model snapshotted for later conversation extraction; this job makes no LLM calls"
                              >
                                {"extraction model · "}
                                {modelChip(requested)}
                                {resolved && (
                                  <>
                                    {" → "}
                                    {modelChip(resolved)}
                                  </>
                                )}
                              </div>
                            );
                          }
                          return (
                            <div
                              className="text-[10px] font-normal text-muted-foreground"
                              title="Planned LLM route; requests may fail over by priority"
                            >
                              {inferenceChip(
                                "provider",
                                planned?.name || context?.providerProfileName,
                              ) || "LLM route"}
                              {requested && (
                                <>
                                  {" · "}
                                  {modelChip(requested)}
                                </>
                              )}
                              {resolved && (
                                <>
                                  {" → "}
                                  {modelChip(resolved)}
                                </>
                              )}
                            </div>
                          );
                        })()}
                        {job.restartedFromJobId && (
                          <Link
                            to={`/jobs/${job.restartedFromJobId}`}
                            onClick={(event) => event.stopPropagation()}
                            className="block text-[10px] font-normal text-amber-500 hover:underline"
                          >
                            restarted from …{job.restartedFromJobId.slice(-6)}
                          </Link>
                        )}
                        {job.restartJobId && (
                          <Link
                            to={`/jobs/${job.restartJobId}`}
                            onClick={(event) => event.stopPropagation()}
                            className="block text-[10px] font-normal text-amber-500 hover:underline"
                          >
                            restarted as …{job.restartJobId.slice(-6)}
                          </Link>
                        )}
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
