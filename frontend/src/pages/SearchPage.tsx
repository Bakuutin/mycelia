import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarX2,
  Database,
  Filter,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { DateRangePicker } from "@/components/DateRangePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DateRangeValue } from "@/lib/datePicker";
import {
  ragApi,
  ragCanonicalRoute,
  ragErrorMessage,
  type RagSearchMode,
  type RagSearchResponse,
  type RagSearchResult,
  type RagSourceRef,
} from "@/lib/rag";

const SOURCE_KINDS = [
  { value: "transcription", label: "Transcriptions" },
  { value: "message", label: "Messages" },
  { value: "object", label: "Objects" },
  { value: "media_visual_description", label: "Media descriptions" },
];

const MODE_COPY: Record<RagSearchMode, string> = {
  hybrid: "Dense and lexical retrieval fused for the best default recall.",
  semantic: "Meaning-based retrieval from the Qdrant vector projection.",
  lexical: "Sparse BM25 retrieval for exact terms and distinctive names.",
};

function displayDate(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}

function firstSourceRef(result: RagSearchResult): RagSourceRef | undefined {
  return result.sourceRefs?.find((source) => source.canonicalUri) ??
    result.sourceRefs?.[0];
}

function resultSource(result: RagSearchResult) {
  const source = firstSourceRef(result);
  return {
    kind: result.source?.kind ?? result.kind ?? source?.kind ??
      result.collection ?? source?.collection ?? "source",
    id: result.source?.id ?? result.sourceId ?? source?.sourceId,
    uri: result.source?.uri ?? result.canonicalUri ?? source?.canonicalUri,
    title: result.source?.title ?? result.title,
    occurredAt: result.source?.start ?? result.occurredAt ?? source?.start,
    end: result.source?.end ?? source?.end,
    representation: result.representation ?? source?.representation,
  };
}

function CanonicalLink({
  uri,
  start,
  end,
}: {
  uri: string;
  start?: string;
  end?: string;
}) {
  const content = (
    <>
      Open source
      <ArrowUpRight className="h-3.5 w-3.5" />
    </>
  );
  const canonicalRoute = ragCanonicalRoute(uri, { start, end });
  if (canonicalRoute) {
    return (
      <Link
        to={canonicalRoute}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {content}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(uri)) {
    return (
      <a
        href={uri}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {content}
      </a>
    );
  }
  return <span className="text-xs text-muted-foreground">{uri}</span>;
}

function ResultCard(
  { result, rank }: { result: RagSearchResult; rank: number },
) {
  const source = resultSource(result);
  const scoreParts = result.scores
    ? Object.entries(result.scores).filter(([, value]) => value != null)
    : [];

  return (
    <Card data-testid="rag-search-result">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">#{rank}</Badge>
              <Badge variant="outline">{source.kind}</Badge>
              {source.representation && (
                <Badge variant="outline" className="font-normal">
                  {source.representation}
                </Badge>
              )}
            </div>
            <CardTitle className="text-base leading-snug">
              {source.title || source.id || result.pointId || result.id}
            </CardTitle>
            {(source.occurredAt || source.id) && (
              <CardDescription className="flex flex-wrap gap-x-3 gap-y-1">
                {source.occurredAt && (
                  <span>{displayDate(source.occurredAt)}</span>
                )}
                {source.id && (
                  <span
                    className="max-w-[34rem] truncate font-mono"
                    title={source.id}
                  >
                    {source.id}
                  </span>
                )}
              </CardDescription>
            )}
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Score
            </div>
            <div className="font-mono text-sm font-semibold">
              {formatScore(result.score)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-6">{result.text}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {scoreParts.map(([label, value]) => (
              <span key={label}>
                {label}:{" "}
                <span className="font-mono">{formatScore(value!)}</span>
              </span>
            ))}
            {result.generation && <span>generation: {result.generation}</span>}
          </div>
          {source.uri && (
            <CanonicalLink
              uri={source.uri}
              start={source.occurredAt}
              end={source.end}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RagSearchMode>("hybrid");
  const [kinds, setKinds] = useState<string[]>([]);
  const [range, setRange] = useState<DateRangeValue | undefined>();
  const [limit, setLimit] = useState("10");
  const [response, setResponse] = useState<RagSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const toggleKind = (kind: string, checked: boolean) => {
    setKinds((current) =>
      checked
        ? [...current, kind]
        : current.filter((candidate) => candidate !== kind)
    );
  };

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setError("Enter a question or phrase to search the knowledge index.");
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setResponse(null);

    try {
      const next = await ragApi.search({
        query: normalizedQuery,
        mode,
        kinds,
        start: range?.start.toISOString(),
        end: range?.end?.toISOString(),
        limit: Number(limit),
      }, controller.signal);
      setResponse(next);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(ragErrorMessage(caught));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const actualMode = response?.mode ?? mode;
  const results = response?.results ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Search className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Smart Search</h1>
        </div>
        <p className="max-w-3xl text-muted-foreground">
          Search the rebuildable Qdrant knowledge projection. Every result keeps
          a link back to its canonical Mycelia source.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search knowledge</CardTitle>
          <CardDescription>{MODE_COPY[mode]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={runSearch}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1 space-y-2">
                <Label htmlFor="rag-query">Question or phrase</Label>
                <Input
                  id="rag-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="What did we decide about the migration?"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2 sm:w-44">
                <Label htmlFor="rag-mode">Search mode</Label>
                <Select
                  value={mode}
                  onValueChange={(value) => setMode(value as RagSearchMode)}
                >
                  <SelectTrigger id="rag-mode" aria-label="Search mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                    <SelectItem value="semantic">Semantic</SelectItem>
                    <SelectItem value="lexical">Lexical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  className="w-full sm:w-auto"
                  disabled={loading}
                >
                  {loading
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Search className="mr-2 h-4 w-4" />}
                  {loading ? "Searching…" : "Search"}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium">
                <SlidersHorizontal className="h-4 w-4" />
                Filters
              </div>
              <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr_8rem]">
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Source kinds</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {SOURCE_KINDS.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={kinds.includes(option.value)}
                          onCheckedChange={(checked) =>
                            toggleKind(option.value, checked === true)}
                          aria-label={option.label}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    No selection searches every indexed source.
                  </p>
                </fieldset>

                <div className="space-y-2">
                  <DateRangePicker
                    value={range}
                    onChange={setRange}
                    label="Date and time range"
                    placeholder="Any date"
                    precision="minute"
                  />
                  {range && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setRange(undefined)}
                    >
                      <CalendarX2 className="mr-1 h-3.5 w-3.5" />
                      Clear range
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rag-limit">Result limit</Label>
                  <Select value={limit} onValueChange={setLimit}>
                    <SelectTrigger id="rag-limit" aria-label="Result limit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 20, 50].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-live="polite" aria-busy={loading} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Knowledge search is unavailable</p>
              <p className="mt-1 text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {response?.degraded && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-400">
                Degraded retrieval
              </p>
              <p className="mt-1 text-muted-foreground">
                {response.warnings?.join(" · ") || response.warning ||
                  `The requested ${mode} search fell back to ${actualMode}.`}
              </p>
            </div>
          </div>
        )}

        {loading && (
          <Card className="p-10 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
            Searching the active projection…
          </Card>
        )}

        {!loading && response && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {results.length} result{results.length === 1 ? "" : "s"}
                </h2>
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="rag-search-summary"
                >
                  {actualMode} retrieval
                  {response.tookMs != null ? ` · ${response.tookMs} ms` : ""}
                </p>
              </div>
              {(response.projectionId || response.projectionFingerprint) && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge
                    variant="outline"
                    className="max-w-full font-mono font-normal"
                  >
                    projection{" "}
                    {response.projectionId || response.projectionFingerprint}
                  </Badge>
                  {response.freshness && (
                    <Badge
                      variant={response.freshness.checkpointState === "error"
                        ? "destructive"
                        : response.freshness.paused
                        ? "secondary"
                        : "outline"}
                      title={response.freshness.checkpointAt
                        ? `Checkpoint ${
                          displayDate(response.freshness.checkpointAt)
                        } · ${response.freshness.checkpointState}`
                        : `Checkpoint timestamp unavailable · ${response.freshness.checkpointState}`}
                    >
                      {response.freshness.lifecycleState}
                      {` · checkpoint ${response.freshness.checkpointState}`}
                      {response.freshness.lagSeconds != null
                        ? ` · ${Math.round(response.freshness.lagSeconds)}s lag`
                        : " · lag unknown"}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {results.length === 0
              ? (
                <Card className="p-10 text-center">
                  <Filter className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                  <p className="font-medium">No indexed evidence matched</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a broader phrase, clear filters, or use hybrid mode.
                  </p>
                </Card>
              )
              : results.map((result, index) => (
                <ResultCard
                  key={`${result.pointId || result.id || "result"}:${index}`}
                  result={result}
                  rank={index + 1}
                />
              ))}
          </div>
        )}

        {!loading && !hasSearched && !error && (
          <Card className="p-10 text-center">
            <Database className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">The knowledge index is ready to query</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Hybrid search is the default. Exact operational facts should still
              be verified against the linked canonical record.
            </p>
          </Card>
        )}
      </section>
    </div>
  );
}
