import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { callResource } from "@/lib/api";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatTime, formatTimeRangeDuration } from "@/lib/formatTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAudioPlayer } from "@/modules/audio/player";
import { embeddingToColor } from "@/lib/pcaColor";
import { ObjectId } from "bson";

interface TranscriptSegment {
  start: number; // seconds from transcript start
  end: number; // seconds from transcript start
  text: string;
}

interface TranscriptionDoc {
  _id: unknown;
  start: Date;
  end: Date;
  original_id: ObjectId;
  segments: TranscriptSegment[];
}

interface RenderSegment {
  original_id: ObjectId;
  time: Date;
  endTime: Date;
  text: string;
  transcriptStart: Date;
}

interface DiarizationDoc {
  _id: unknown;
  start: Date;
  end: Date;
  original: ObjectId;
  embedding?: number[];
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
    const docs: DiarizationDoc[] = await callResource("tech.mycelia.mongo", {
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
    const docs: TranscriptionDoc[] = await callResource("tech.mycelia.mongo", {
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
            original_id: doc.original_id,
          });
        }
      }
    }
    rendered.sort((a, b) => a.time.getTime() - b.time.getTime());
    return rendered;
  }

  async function handleApplyRange() {
    if (!formStartDate || !formEndDate) return;
    const startNorm = formStartDate.getTime() > formEndDate.getTime()
      ? formEndDate
      : formStartDate;
    const endNorm = formStartDate.getTime() > formEndDate.getTime()
      ? formStartDate
      : formEndDate;
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
          segments: 1,
          score: { $meta: "textScore" },
        },
      },
      { $limit: 200 },
    ];

    const docs: TranscriptionDoc[] = await callResource("tech.mycelia.mongo", {
      action: "aggregate",
      collection: "transcriptions",
      pipeline,
    });

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
              original_id: doc.original_id,
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
    handleApplyRange();
  }

  function handlePlayFromSegment(segmentTime: Date) {
    resetDate(segmentTime);
    setIsPlaying(true);
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
        const [rendered, diarizationsData] = await Promise.all([
          fetchSegmentsRange(s, e),
          fetchDiarizationsRange(s, e),
        ]);
        setSegments(rendered);
        setDiarizations(diarizationsData);
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
  }, [startDate, endDate, startParam, endParam]);

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
        className="space-y-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleApplyRange();
        }}
      >
        <div className="flex gap-2">
          <label htmlFor="start">Start</label>

          <DateTimePicker
            value={formStartDate}
            onChange={(date) => date && setFormStartDate(date)}
            placeholder="Start"
          />
        </div>
        <div className="flex gap-2">
          <label htmlFor="end">End</label>
          <DateTimePicker
            value={formEndDate}
            onChange={(date) => date && setFormEndDate(date)}
            placeholder="End"
          />
        </div>
        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
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
                    ? diarizations.filter(
                        (d) =>
                          d.original === seg.original_id &&
                          d.start.getTime() < seg.endTime.getTime() &&
                        d.end.getTime() > seg.time.getTime(),
                      )
                    : [];

                  return (
                    <div key={idx} className="relative p-4">
                      {gapBadge}
                      <div className="flex gap-3">
                        <div className="flex flex-col gap-1 items-center pt-1">
                          {diarizationsInSegment.map((diarization, diarIdx) => {
                            const color = embeddingToColor(diarization.embedding) || "#eab308";
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
                                    <div className="font-semibold">Diarization</div>
                                    <div className="text-xs">
                                      <div>Start: {formatTime(diarization.start, timeFormat)}</div>
                                      <div>End: {formatTime(diarization.end, timeFormat)}</div>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const diarizationId = diarization._id instanceof ObjectId
                                          ? diarization._id.toString()
                                          : String(diarization._id);
                                        navigate(`/diarizations/${diarizationId}`);
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
                                <span>{formatTimeRangeDuration(seg.time, seg.endTime)}</span>
                            </div>
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
