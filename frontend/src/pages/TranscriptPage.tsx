import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { callResource } from "@/lib/api";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatTime, formatTimeRangeDuration } from "@/lib/formatTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAudioPlayer } from "@/modules/audio/player";
import { embeddingToColor } from "@/lib/pcaColor";
import { ObjectId } from "bson";
import {
  diarizationOverlapsTranscript,
  normalizeObjectId,
} from "@/lib/diarization";
import { SpeakerBadge } from "@/modules/speakers";

interface TranscriptSegment {
  start: number; // seconds from transcript start
  end: number; // seconds from transcript start
  text: string;
}

interface TranscriptionDoc {
  _id: unknown;
  start: Date;
  end: Date;
  original: ObjectId;
  segments: TranscriptSegment[];
}

interface RenderSegment {
  original_id: ObjectId;
  time: Date;
  endTime: Date;
  text: string;
  transcriptStart: Date;
  parent: TranscriptionDoc;
}

interface DiarizationDoc {
  _id: unknown;
  start: Date;
  end: Date;
  original?: ObjectId;
  original_id?: ObjectId;
  speaker?: string;
  embedding?: number[];
  matched_speaker?: {
    profile_id: unknown;
    name: string;
    similarity: number;
  };
}

interface ConversationDoc {
  _id: unknown;
  name?: string;
  timeRanges?: Array<{
    start: Date | string;
    end?: Date | string;
  }>;
}

interface ResolvedConversation {
  id: string;
  name?: string;
  start: Date;
  end: Date;
}

function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  // Support ISO strings and millis since epoch
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value.trim() !== "") {
    const d = new Date(asNumber);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function replaceLocalDate(current: Date, value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const next = new Date(current);
  next.setFullYear(year, month - 1, day);
  return Number.isNaN(next.getTime()) ? null : next;
}

function replaceLocalTime(current: Date, value: string): Date | null {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const next = new Date(current);
  next.setHours(hours, minutes, 0, 0);
  return Number.isNaN(next.getTime()) ? null : next;
}

function TranscriptDateTimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: Date;
  onChange: (date: Date) => void;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end">
      <label className="grid gap-1 text-sm font-medium">
        <span>{label} date</span>
        <Input
          type="date"
          aria-label={`${label} date`}
          value={value ? toDateInputValue(value) : ""}
          onChange={(event) => {
            const next = replaceLocalDate(
              value ?? new Date(),
              event.target.value,
            );
            if (next) onChange(next);
          }}
          className="w-full sm:w-[170px]"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        <span>Time</span>
        <Input
          type="time"
          aria-label={`${label} time`}
          value={value ? toTimeInputValue(value) : ""}
          onChange={(event) => {
            const next = replaceLocalTime(
              value ?? new Date(),
              event.target.value,
            );
            if (next) onChange(next);
          }}
          className="w-full sm:w-[130px]"
        />
      </label>
    </div>
  );
}

const TranscriptPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { timeFormat } = useSettingsStore();
  const { resetDate, setIsPlaying } = useAudioPlayer();

  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  const startDate = useMemo(() => {
    const parsed = parseDateParam(startParam);
    if (parsed) return parsed;
    // Default to 24 hours ago if no start parameter
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
  }, [startParam]);

  const endDate = useMemo(() => {
    const parsed = parseDateParam(endParam);
    if (parsed) return parsed;
    // Default to now if no end parameter
    return new Date();
  }, [endParam]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<RenderSegment[]>([]);
  const [diarizations, setDiarizations] = useState<DiarizationDoc[]>([]);
  const [loadingTop, setLoadingTop] = useState(false);
  const [loadingBottom, setLoadingBottom] = useState(false);
  const [displayStart, setDisplayStart] = useState<Date | null>(null);
  const [displayEnd, setDisplayEnd] = useState<Date | null>(null);
  const suppressRefetch = useRef(false);

  const initialQ = searchParams.get("q") || "";
  const [q, setQ] = useState<string>(initialQ);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSegments, setSearchSegments] = useState<RenderSegment[]>([]);
  const [lastSearchedQ, setLastSearchedQ] = useState<string>(initialQ);
  const [openingConversationKey, setOpeningConversationKey] = useState<
    string | null
  >(null);

  const [formStartDate, setFormStartDate] = useState<Date | undefined>(
    undefined,
  );
  const [formEndDate, setFormEndDate] = useState<Date | undefined>(undefined);

  function updateRange(newStart: Date, newEnd: Date) {
    const currentSearch = new URLSearchParams(window.location.search);
    currentSearch.set("start", newStart.getTime().toString());
    currentSearch.set("end", newEnd.getTime().toString());
    const newSearch = currentSearch.toString();
    window.history.pushState(null, "", `?${newSearch}`);
  }

  function escapeRegex(source: string) {
    return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function renderHighlightedText(text: string, query: string) {
    const words = query
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length === 0) return text;
    const pattern = `(${words.map(escapeRegex).join("|")})`;
    const splitRe = new RegExp(pattern, "gi");
    const checkRe = new RegExp(pattern, "i");
    const parts = text.split(splitRe);
    return (
      <>
        {parts.map((part, idx) =>
          checkRe.test(part)
            ? (
              <mark key={idx} className="bg-yellow-200">
                {part}
              </mark>
            )
            : <span key={idx}>{part}</span>
        )}
      </>
    );
  }

  async function fetchDiarizationsRange(
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<DiarizationDoc[]> {
    const docs: DiarizationDoc[] = await callResource("mongo", {
      action: "find",
      collection: "diarizations",
      query: {
        start: { $lt: rangeEnd },
        end: { $gt: rangeStart },
      },
      options: { sort: { start: 1 }, limit: 5000 },
    });
    return docs;
  }

  async function fetchSegmentsRange(
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<RenderSegment[]> {
    const docs: TranscriptionDoc[] = await callResource("mongo", {
      action: "find",
      collection: "transcriptions",
      query: {
        start: { $lt: rangeEnd },
        end: { $gt: rangeStart },
      },
      options: { sort: { start: 1 }, limit: 2000 },
    });

    const rendered: RenderSegment[] = [];
    for (const doc of docs) {
      for (const s of doc.segments || []) {
        const absStart = new Date(doc.start.getTime() + s.start * 1000);
        const absEnd = new Date(doc.start.getTime() + s.end * 1000);
        if (absEnd > rangeStart && absStart < rangeEnd) {
          rendered.push({
            time: absStart,
            endTime: absEnd,
            text: (s.text || "").replace(/\n/g, " "),
            transcriptStart: doc.start,
            original_id: doc.original,
            parent: doc,
          });
        }
      }
    }
    rendered.sort((a, b) => a.time.getTime() - b.time.getTime());
    return rendered;
  }

  async function applyRange(rangeStart: Date, rangeEnd: Date) {
    const startNorm = rangeStart.getTime() > rangeEnd.getTime()
      ? rangeEnd
      : rangeStart;
    const endNorm = rangeStart.getTime() > rangeEnd.getTime()
      ? rangeStart
      : rangeEnd;
    setLoading(true);
    setError(null);
    setSearchError(null);
    try {
      const [rendered, diarizationsData] = await Promise.all([
        fetchSegmentsRange(startNorm, endNorm),
        fetchDiarizationsRange(startNorm, endNorm),
      ]);
      setSegments(rendered);
      setDiarizations(diarizationsData);
      setDisplayStart(startNorm);
      setDisplayEnd(endNorm);
      setFormStartDate(startNorm);
      setFormEndDate(endNorm);
      updateRange(startNorm, endNorm);
      const query = q.trim();
      if (query) {
        setSearching(true);
        const results = await fetchSearch(startNorm, endNorm, query);
        setSearchSegments(results);
        setLastSearchedQ(query);
        const currentSearch = new URLSearchParams(window.location.search);
        currentSearch.set("q", query);
        const newSearch = currentSearch.toString();
        window.history.pushState(null, "", `?${newSearch}`);
      } else {
        setSearchSegments([]);
        setLastSearchedQ("");
        const currentSearch = new URLSearchParams(window.location.search);
        currentSearch.delete("q");
        const newSearch = currentSearch.toString();
        window.history.pushState(null, "", `?${newSearch}`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch transcripts",
      );
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }

  async function handleApplyRange() {
    if (!formStartDate || !formEndDate) return;
    await applyRange(formStartDate, formEndDate);
  }

  function applyQuickRange(
    preset: "today" | "yesterday" | "week" | "month",
  ) {
    const now = new Date();
    const start = new Date(now);
    let end = new Date(now);

    if (preset === "today") {
      start.setHours(0, 0, 0, 0);
    } else if (preset === "yesterday") {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
    } else if (preset === "week") {
      start.setDate(start.getDate() - 7);
    } else {
      start.setDate(start.getDate() - 30);
    }

    setFormStartDate(start);
    setFormEndDate(end);
    void applyRange(start, end);
  }

  async function fetchSearch(
    rangeStart: Date,
    rangeEnd: Date,
    query: string,
  ): Promise<RenderSegment[]> {
    if (!query.trim()) return [];
    const pipeline = [
      {
        $match: {
          start: { $lt: rangeEnd },
          end: { $gt: rangeStart },
          $text: { $search: query },
        },
      },
      { $sort: { score: { $meta: "textScore" } } },
      {
        $project: {
          start: 1,
          end: 1,
          original: 1,
          segments: 1,
          score: { $meta: "textScore" },
        },
      },
      { $limit: 200 },
    ];

    let docs: TranscriptionDoc[] = await callResource("mongo", {
      action: "aggregate",
      collection: "transcriptions",
      pipeline,
    });

    // MongoDB text indexes may omit pure numbers and some short/stemmed words.
    // Fall back to a literal case-insensitive match so saved phrase links such
    // as `q=300` still work as users expect.
    if (docs.length === 0) {
      docs = await callResource("mongo", {
        action: "find",
        collection: "transcriptions",
        query: {
          start: { $lt: rangeEnd },
          end: { $gt: rangeStart },
          text: {
            $regex: escapeRegex(query.trim()),
            $options: "i",
          },
        },
        options: { sort: { start: 1 }, limit: 200 },
      }) as TranscriptionDoc[];
    }

    const loweredWords = query
      .split(/\s+/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    const rendered: RenderSegment[] = [];
    for (const doc of docs) {
      for (const s of doc.segments || []) {
        const absStart = new Date(doc.start.getTime() + s.start * 1000);
        const absEnd = new Date(doc.start.getTime() + s.end * 1000);
        if (absEnd > rangeStart && absStart < rangeEnd) {
          const t = (s.text || "").replace(/\n/g, " ");
          const lt = t.toLowerCase();
          if (loweredWords.some((w) => lt.includes(w))) {
            rendered.push({
              time: absStart,
              endTime: absEnd,
              text: t,
              transcriptStart: doc.start,
              parent: doc,
              original_id: doc.original,
            });
          }
        }
      }
    }
    rendered.sort((a, b) => a.time.getTime() - b.time.getTime());
    return rendered;
  }

  // Single-button flow handles both range and search; no separate handlers needed

  async function handleLoadEarlier() {
    if (!displayStart || !displayEnd || loadingTop) return;
    setLoadingTop(true);
    try {
      let windowMs = 60 * 60 * 1000; // 1 hour
      let collected: RenderSegment[] = [];
      for (let i = 0; i < 5 && collected.length < 100; i++) {
        const rangeStart = new Date(displayStart.getTime() - windowMs);
        const [segs, diarizationsData] = await Promise.all([
          fetchSegmentsRange(rangeStart, displayStart),
          fetchDiarizationsRange(rangeStart, displayStart),
        ]);
        collected = segs;
        if (collected.length < 100) windowMs *= 2; // expand window
        setDiarizations((prev) => [...diarizationsData, ...prev]);
      }
      if (collected.length === 0) return;
      const take = collected.slice(-100);
      setSegments((prev) => [...take, ...prev]);
      const newStart = take[0]?.time ?? displayStart;
      setDisplayStart(newStart);
      updateRange(newStart, displayEnd);
    } finally {
      setLoadingTop(false);
    }
  }

  async function handleLoadLater() {
    if (!displayStart || !displayEnd || loadingBottom) return;
    setLoadingBottom(true);
    try {
      let windowMs = 60 * 60 * 1000; // 1 hour
      let collected: RenderSegment[] = [];
      for (let i = 0; i < 5 && collected.length < 100; i++) {
        const rangeEnd = new Date(displayEnd.getTime() + windowMs);
        const [segs, diarizationsData] = await Promise.all([
          fetchSegmentsRange(displayEnd, rangeEnd),
          fetchDiarizationsRange(displayEnd, rangeEnd),
        ]);
        collected = segs;
        if (collected.length < 100) windowMs *= 2; // expand window
        setDiarizations((prev) => [...prev, ...diarizationsData]);
      }
      if (collected.length === 0) return;
      const take = collected.slice(0, 100);
      setSegments((prev) => [...prev, ...take]);
      const newEnd = take[take.length - 1]?.time ?? displayEnd;
      setDisplayEnd(newEnd);
      updateRange(displayStart, newEnd);
    } finally {
      setLoadingBottom(false);
    }
  }

  function handleGoToLatest15Min() {
    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    setFormStartDate(fifteenMinutesAgo);
    setFormEndDate(now);
    void applyRange(fifteenMinutesAgo, now);
  }

  function handlePlayFromSegment(segmentTime: Date) {
    resetDate(segmentTime);
    setIsPlaying(true);
  }

  async function resolveConversation(
    seg: RenderSegment,
  ): Promise<ResolvedConversation | null> {
    const conversations = await callResource("mongo", {
      action: "find",
      collection: "objects",
      query: {
        isConversation: true,
        timeRanges: {
          $elemMatch: {
            start: { $lte: seg.time },
            end: { $gte: seg.endTime },
          },
        },
      },
      options: { limit: 50 },
    }) as ConversationDoc[];

    const containingRanges = conversations.flatMap((conversation) =>
      (conversation.timeRanges ?? []).flatMap((range) => {
        if (!range.end) return [];
        const start = new Date(range.start);
        const end = new Date(range.end);
        if (
          Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
          start > seg.time || end < seg.endTime
        ) {
          return [];
        }
        const id = normalizeObjectId(conversation._id) ??
          String(conversation._id);
        return [{ id, name: conversation.name, start, end }];
      })
    ).sort((a, b) =>
      (a.end.getTime() - a.start.getTime()) -
      (b.end.getTime() - b.start.getTime())
    );

    return containingRanges[0] ?? null;
  }

  async function handleOpenConversationObject(seg: RenderSegment) {
    const key = `summary-${seg.time.getTime()}-${seg.endTime.getTime()}`;
    setOpeningConversationKey(key);
    setSearchError(null);

    try {
      const conversation = await resolveConversation(seg);
      if (!conversation) {
        throw new Error("No Conversation object exists for this phrase yet");
      }
      navigate(`/objects/${conversation.id}`);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Failed to open conversation",
      );
    } finally {
      setOpeningConversationKey(null);
    }
  }

  async function handleOpenFullConversation(seg: RenderSegment) {
    const key = `full-${seg.time.getTime()}-${seg.endTime.getTime()}`;
    setOpeningConversationKey(key);
    setSearchError(null);

    try {
      const conversation = await resolveConversation(seg);

      let range = conversation
        ? { start: conversation.start, end: conversation.end }
        : undefined;

      // Older recordings may not have an extracted Conversation object yet.
      // In that case, use all transcription chunks from the same source audio.
      if (!range && seg.original_id) {
        const [firstDocs, lastDocs] = await Promise.all([
          callResource("mongo", {
            action: "find",
            collection: "transcriptions",
            query: { original: seg.original_id },
            options: { sort: { start: 1 }, limit: 1 },
          }) as Promise<TranscriptionDoc[]>,
          callResource("mongo", {
            action: "find",
            collection: "transcriptions",
            query: { original: seg.original_id },
            options: { sort: { end: -1 }, limit: 1 },
          }) as Promise<TranscriptionDoc[]>,
        ]);

        if (firstDocs[0] && lastDocs[0]) {
          range = {
            start: new Date(firstDocs[0].start),
            end: new Date(lastDocs[0].end),
          };
        }
      }

      if (!range) {
        throw new Error("Could not find the full conversation for this phrase");
      }

      setQ("");
      setLastSearchedQ("");
      setSearchSegments([]);
      setSegments([]);
      navigate(
        `?start=${range.start.getTime()}&end=${range.end.getTime()}`,
      );
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Failed to open conversation",
      );
    } finally {
      setOpeningConversationKey(null);
    }
  }

  useEffect(() => {
    const initialFetch = async () => {
      if (!startDate || !endDate) return;
      if (suppressRefetch.current) return; // URL update from in-page actions
      setLoading(true);
      setError(null);
      try {
        let s = startDate;
        let e = endDate;
        if (s.getTime() > e.getTime()) {
          const tmp = s;
          s = e;
          e = tmp;
          updateRange(s, e);
        }
        const query = initialQ.trim();
        const [rendered, diarizationsData, searchedSegments] = await Promise
          .all([
            fetchSegmentsRange(s, e),
            fetchDiarizationsRange(s, e),
            query ? fetchSearch(s, e, query) : Promise.resolve([]),
          ]);
        setSegments(rendered);
        setDiarizations(diarizationsData);
        setSearchSegments(searchedSegments);
        setLastSearchedQ(query);
        setQ(query);
        setDisplayStart(s);
        setDisplayEnd(e);
        setFormStartDate(s);
        setFormEndDate(e);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch transcripts",
        );
      } finally {
        setLoading(false);
      }
    };

    // Initialize form fields with default values if no URL parameters
    if (!startParam && !endParam) {
      setFormStartDate(startDate);
      setFormEndDate(endDate);
    }

    initialFetch();
  }, [startDate, endDate, startParam, endParam, initialQ]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Transcript</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading transcripts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Transcript</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Transcript</h1>
      </div>

      <form
        className="space-y-4 rounded-lg border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleApplyRange();
        }}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <TranscriptDateTimeInput
            label="Start"
            value={formStartDate}
            onChange={setFormStartDate}
          />
          <TranscriptDateTimeInput
            label="End"
            value={formEndDate}
            onChange={setFormEndDate}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">
            Quick range
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyQuickRange("today")}
            disabled={loading || searching}
          >
            Today
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyQuickRange("yesterday")}
            disabled={loading || searching}
          >
            Yesterday
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyQuickRange("week")}
            disabled={loading || searching}
          >
            Last 7 days
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyQuickRange("month")}
            disabled={loading || searching}
          >
            Last 30 days
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search transcript…"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleGoToLatest15Min}
            disabled={loading || searching}
          >
            Latest 15min
          </Button>
          <Button
            type="submit"
            disabled={loading || !formStartDate || !formEndDate || searching}
          >
            {searching ? "Applying…" : "Apply"}
          </Button>
        </div>
      </form>

      {lastSearchedQ && searchError
        ? (
          <div className="border rounded-lg p-8 text-center">
            <p className="text-red-500">Error: {searchError}</p>
          </div>
        )
        : null}

      {!lastSearchedQ && (
        <div className="flex items-center justify-start">
          <Button
            type="button"
            variant="secondary"
            onClick={handleLoadEarlier}
            disabled={loading || loadingTop}
          >
            −100
          </Button>
        </div>
      )}

      <div className="border rounded-lg">
        {(lastSearchedQ && searchSegments.length === 0) ||
            (!lastSearchedQ && segments.length === 0)
          ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">
                No transcript segments{lastSearchedQ
                  ? " matching your search"
                  : ""} in this interval
              </p>
            </div>
          )
          : (
            <div className="divide-y">
              {(lastSearchedQ ? searchSegments : segments).map(
                (seg, idx, arr) => {
                  const prev = idx > 0 ? arr[idx - 1] : null;
                  const showGap = prev &&
                    seg.time.getTime() - prev.endTime.getTime() > 3 * 1000;
                  const gapBadge = showGap
                    ? (
                      <div className="absolute left-1/2 -top-0">
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          style={{ transform: "translate(-50%, -14px)" }}
                        >
                          {formatTimeRangeDuration(prev!.endTime, seg.time)}
                        </Badge>
                      </div>
                    )
                    : null;

                  const diarizationsInSegment = !lastSearchedQ
                    ? diarizations.filter((d) =>
                      diarizationOverlapsTranscript(d, seg)
                    )
                    : [];
                  const identifiedSpeakers = Array.from(
                    new Map(
                      diarizationsInSegment
                        .filter((d) => d.matched_speaker)
                        .map((d) => [
                          normalizeObjectId(
                            d.matched_speaker!.profile_id,
                          ) ?? d.matched_speaker!.name,
                          d,
                        ]),
                    ).values(),
                  );

                  return (
                    <div key={idx} className="relative p-4">
                      {gapBadge}
                      <div className="flex gap-3">
                        <div className="flex flex-col gap-1 items-center pt-1">
                          {diarizationsInSegment.map((diarization, diarIdx) => {
                            const color =
                              embeddingToColor(diarization.embedding) ||
                              "#eab308";
                            return (
                              <Tooltip key={`${diarization._id}-${diarIdx}`}>
                                <TooltipTrigger asChild>
                                  <div
                                    className="w-2 h-2 rounded-full cursor-help flex-shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="space-y-2">
                                    <div className="font-semibold">
                                      Diarization
                                    </div>
                                    <div>
                                      Speaker:{" "}
                                      {diarization.matched_speaker?.name ??
                                        diarization.speaker ?? "Unknown"}
                                    </div>
                                    {diarization.matched_speaker && (
                                      <div>
                                        Match: {Math.round(
                                          diarization.matched_speaker
                                            .similarity * 100,
                                        )}%
                                      </div>
                                    )}
                                    <div className="text-xs">
                                      <div>
                                        Start: {formatTime(
                                          diarization.start,
                                          timeFormat,
                                        )}
                                      </div>
                                      <div>
                                        End: {formatTime(
                                          diarization.end,
                                          timeFormat,
                                        )}
                                      </div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const diarizationId =
                                          diarization._id instanceof ObjectId
                                            ? diarization._id.toString()
                                            : String(diarization._id);
                                        navigate(
                                          `/diarizations/${diarizationId}`,
                                        );
                                      }}
                                      className="w-full mt-2"
                                    >
                                      Go to diarization
                                    </Button>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <button
                              type="button"
                              onClick={() => handlePlayFromSegment(seg.time)}
                              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                              title="Play from here"
                            >
                              <svg
                                className="w-3 h-3"
                                fill="currentColor"
                                viewBox="0 0 16 16"
                              >
                                <path d="M3 2v12l10-6L3 2z" />
                              </svg>
                            </button>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <span>{formatTime(seg.time, timeFormat)}</span>
                              <span>
                                {formatTimeRangeDuration(seg.time, seg.endTime)}
                              </span>
                              {lastSearchedQ && (
                                <>
                                  <button
                                    type="button"
                                    className="ml-2 text-blue-600 hover:text-blue-800 hover:underline"
                                    onClick={() => {
                                      const center = seg.time.getTime();
                                      const offset = 5 * 60 * 1000;
                                      setQ("");
                                      setLastSearchedQ("");
                                      setSearchSegments([]);
                                      setSegments([]);
                                      navigate(
                                        `?start=${center - offset}&end=${
                                          center + offset
                                        }`,
                                      );
                                    }}
                                  >
                                    Context
                                  </button>
                                  <button
                                    type="button"
                                    className="ml-2 text-blue-600 hover:text-blue-800 hover:underline disabled:cursor-wait disabled:opacity-50"
                                    disabled={openingConversationKey ===
                                      `full-${seg.time.getTime()}-${seg.endTime.getTime()}`}
                                    onClick={() =>
                                      handleOpenFullConversation(seg)}
                                  >
                                    {openingConversationKey ===
                                        `full-${seg.time.getTime()}-${seg.endTime.getTime()}`
                                      ? "Opening…"
                                      : "Full conversation"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ml-2 font-medium text-blue-600 hover:text-blue-800 hover:underline disabled:cursor-wait disabled:opacity-50"
                                    disabled={openingConversationKey ===
                                      `summary-${seg.time.getTime()}-${seg.endTime.getTime()}`}
                                    onClick={() =>
                                      handleOpenConversationObject(seg)}
                                  >
                                    {openingConversationKey ===
                                        `summary-${seg.time.getTime()}-${seg.endTime.getTime()}`
                                      ? "Opening…"
                                      : "Conversation & summary"}
                                  </button>
                                </>
                              )}
                            </div>
                            {identifiedSpeakers.map((diarization) => (
                              <SpeakerBadge
                                key={normalizeObjectId(
                                  diarization.matched_speaker!.profile_id,
                                ) ?? diarization.matched_speaker!.name}
                                name={diarization.matched_speaker!.name}
                                similarity={diarization.matched_speaker!
                                  .similarity}
                                color={embeddingToColor(
                                  diarization.embedding,
                                ) || "#6b7280"}
                              />
                            ))}
                          </div>
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {lastSearchedQ
                              ? renderHighlightedText(seg.text, lastSearchedQ)
                              : seg.text}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
      </div>

      {!lastSearchedQ && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={handleLoadLater}
            disabled={loading || loadingBottom}
          >
            +100
          </Button>
        </div>
      )}
    </div>
  );
};

export default TranscriptPage;
