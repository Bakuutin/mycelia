import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { callResource } from '@/lib/api';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatTime, formatTimeRangeDuration } from '@/lib/formatTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateTimeInput, toLocalDateTime } from '@/components/forms/DateTimeInput';

interface TranscriptSegment {
  start: number; // seconds from transcript start
  end: number;   // seconds from transcript start
  text: string;
}

interface TranscriptionDoc {
  _id: unknown;
  start: Date;
  end: Date;
  segments: TranscriptSegment[];
}

interface RenderSegment {
  time: Date;
  endTime: Date;
  text: string;
  transcriptStart: Date;
}

function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  // Support ISO strings and millis since epoch
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value.trim() !== '') {
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

  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

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
  const [loadingTop, setLoadingTop] = useState(false);
  const [loadingBottom, setLoadingBottom] = useState(false);
  const [displayStart, setDisplayStart] = useState<Date | null>(null);
  const [displayEnd, setDisplayEnd] = useState<Date | null>(null);
  const suppressRefetch = useRef(false);

  const initialQ = searchParams.get('q') || '';
  const [q, setQ] = useState<string>(initialQ);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSegments, setSearchSegments] = useState<RenderSegment[]>([]);
  const [lastSearchedQ, setLastSearchedQ] = useState<string>(initialQ);

  const [startStr, setStartStr] = useState<string>('');
  const [endStr, setEndStr] = useState<string>('');

  function updateRange(newStart: Date, newEnd: Date) {
    const currentSearch = new URLSearchParams(window.location.search);
    currentSearch.set('start', newStart.getTime().toString());
    currentSearch.set('end', newEnd.getTime().toString());
    const newSearch = currentSearch.toString();
    window.history.pushState(null, '', `?${newSearch}`);
  }

  function escapeRegex(source: string) {
    return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function renderHighlightedText(text: string, query: string) {
    const words = query
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length === 0) return text;
    const pattern = `(${words.map(escapeRegex).join('|')})`;
    const splitRe = new RegExp(pattern, 'gi');
    const checkRe = new RegExp(pattern, 'i');
    const parts = text.split(splitRe);
    return (
      <>
        {parts.map((part, idx) =>
          checkRe.test(part) ? (
            <mark key={idx} className="bg-yellow-200">
              {part}
            </mark>
          ) : (
            <span key={idx}>{part}</span>
          )
        )}
      </>
    );
  }

  async function fetchSegmentsRange(rangeStart: Date, rangeEnd: Date): Promise<RenderSegment[]> {
    const docs: TranscriptionDoc[] = await callResource("tech.mycelia.mongo", {
      action: "find",
      collection: "transcriptions",
      query: {
        start: { $lt: rangeEnd },
        end: { $gt: rangeStart },
      },
      options: { sort: { start: 1 }, limit: 10000 },
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
            text: (s.text || '').replace(/\n/g, ' '),
            transcriptStart: doc.start,
          });
        }
      }
    }
    rendered.sort((a, b) => a.time.getTime() - b.time.getTime());
    return rendered;
  }

  async function handleApplyRange() {
    if (!startStr || !endStr) return;
    const s = new Date(startStr);
    const e = new Date(endStr);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;
    const startNorm = s.getTime() > e.getTime() ? e : s;
    const endNorm = s.getTime() > e.getTime() ? s : e;
    setLoading(true);
    setError(null);
    setSearchError(null);
    try {
      const rendered = await fetchSegmentsRange(startNorm, endNorm);
      setSegments(rendered);
      setDisplayStart(startNorm);
      setDisplayEnd(endNorm);
      setStartStr(toLocalDateTime(startNorm));
      setEndStr(toLocalDateTime(endNorm));
      updateRange(startNorm, endNorm);
      const query = q.trim();
      if (query) {
        setSearching(true);
        const results = await fetchSearch(startNorm, endNorm, query);
        setSearchSegments(results);
        setLastSearchedQ(query);
        const currentSearch = new URLSearchParams(window.location.search);
        currentSearch.set('q', query);
        const newSearch = currentSearch.toString();
        window.history.pushState(null, '', `?${newSearch}`);
      } else {
        setSearchSegments([]);
        setLastSearchedQ('');
        const currentSearch = new URLSearchParams(window.location.search);
        currentSearch.delete('q');
        const newSearch = currentSearch.toString();
        window.history.pushState(null, '', `?${newSearch}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transcripts');
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }

  async function fetchSearch(rangeStart: Date, rangeEnd: Date, query: string): Promise<RenderSegment[]> {
    if (!query.trim()) return [];
    const pipeline = [
      {
        $match: {
          start: { $lt: rangeEnd },
          end: { $gt: rangeStart },
          $text: { $search: query },
        },
      },
      { $sort: { score: { $meta: 'textScore' } } },
      { $project: { start: 1, end: 1, segments: 1, score: { $meta: 'textScore' } } },
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
          const t = (s.text || '').replace(/\n/g, ' ');
          const lt = t.toLowerCase();
          if (loweredWords.some((w) => lt.includes(w))) {
            rendered.push({
              time: absStart,
              endTime: absEnd,
              text: t,
              transcriptStart: doc.start,
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
        const segs = await fetchSegmentsRange(rangeStart, displayStart);
        collected = segs;
        if (collected.length < 100) windowMs *= 2; // expand window
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
        const segs = await fetchSegmentsRange(displayEnd, rangeEnd);
        collected = segs;
        if (collected.length < 100) windowMs *= 2; // expand window
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
        const rendered = await fetchSegmentsRange(s, e);
        setSegments(rendered);
        setDisplayStart(s);
        setDisplayEnd(e);
        setStartStr(toLocalDateTime(s));
        setEndStr(toLocalDateTime(e));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch transcripts');
      } finally {
        setLoading(false);
      }
    };

    // Initialize form fields with default values if no URL parameters
    if (!startParam && !endParam) {
      setStartStr(toLocalDateTime(startDate));
      setEndStr(toLocalDateTime(endDate));
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
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          handleApplyRange();
        }}
      >
        <div className="flex gap-2 w-full sm:w-auto">
          <DateTimeInput
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
            placeholder="Start"
          />
          <DateTimeInput
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            placeholder="End"
          />
        </div>
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search transcript (optional)"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={loading || !startStr || !endStr || searching}>
            {searching ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </form>

      {lastSearchedQ && searchError ? (
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {searchError}</p>
        </div>
      ) : null}

      {!lastSearchedQ && (
        <div className="flex items-center justify-start">
          <Button type="button" variant="secondary" onClick={handleLoadEarlier} disabled={loading || loadingTop}>
            −100
          </Button>
        </div>
      )}

      <div className="border rounded-lg">
        {(lastSearchedQ && searchSegments.length === 0) || (!lastSearchedQ && segments.length === 0) ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">No transcript segments{lastSearchedQ ? ' matching your search' : ''} in this interval</p>
          </div>
        ) : (
          <div className="divide-y">
            {(lastSearchedQ ? searchSegments : segments).map((seg, idx, arr) => {
              const prev = idx > 0 ? arr[idx - 1] : null;
              const showGap = prev && seg.time.getTime() - prev.endTime.getTime() > 3 * 1000;
              const gapBadge = showGap ? (
                <div className="absolute left-1/2 -top-0">
                  <Badge variant="secondary" className="text-xs" style={{ transform: 'translate(-50%, -14px)' }}>
                    {formatTimeRangeDuration(prev!.endTime, seg.time)}
                  </Badge>
                </div>
              ) : null;

              return (
                <div key={idx} className="relative p-4">
                  {gapBadge}
                  <div className="text-xs text-muted-foreground mb-1">
                    {formatTime(seg.time, timeFormat)}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{lastSearchedQ ? renderHighlightedText(seg.text, lastSearchedQ) : seg.text}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!lastSearchedQ && (
        <div className="flex items-center justify-end">
          <Button type="button" variant="secondary" onClick={handleLoadLater} disabled={loading || loadingBottom}>
            +100
          </Button>
        </div>
      )}
    </div>
  );
};

export default TranscriptPage;


