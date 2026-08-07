import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { getJobErrorCode, parseJobError } from "@/lib/jobErrors";

type FailureRow = {
  id: string;
  type: string;
  timestamp?: number;
  dismissed: boolean;
  reason: string;
};

type ErrorStatsResponse = {
  sinceDays: number;
  truncated: boolean;
  failures: FailureRow[];
};

type ErrorGroup = {
  key: string;
  rows: FailureRow[];
  byType: Map<string, number>;
  firstAt: number;
  lastAt: number;
  perDay: Map<string, number>;
};

/**
 * Stable bucket for one failure: explicit code, else classifier label.
 * Shared with the jobs-list error filter so both group identically.
 */
export function classifyJobFailure(reason: string): string {
  return getJobErrorCode(reason) ?? parseJobError(reason)?.label ?? "Other";
}

function dayKey(ts: number): string {
  return format(new Date(ts), "yyyy-MM-dd");
}

/** Last `days` day-keys, oldest first, so histograms include empty days. */
function lastDays(days: number): string[] {
  const keys: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    keys.push(dayKey(now - i * 24 * 60 * 60 * 1000));
  }
  return keys;
}

function DayHistogram(
  { perDay, days }: { perDay: Map<string, number>; days: string[] },
) {
  const max = Math.max(1, ...days.map((d) => perDay.get(d) ?? 0));
  return (
    <div className="flex h-6 items-end gap-px" title="Failures per day">
      {days.map((d) => {
        const n = perDay.get(d) ?? 0;
        return (
          <div
            key={d}
            className={`w-1.5 rounded-sm ${
              n > 0 ? "bg-red-500/70" : "bg-muted"
            }`}
            style={{ height: `${Math.max(8, (n / max) * 100)}%` }}
            title={`${d}: ${n}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Failure analysis panel for the Jobs page: groups every failed job in the
 * selected window by error type, shows counts, per-worker breakdown and a
 * per-day histogram, and expands into the matching jobs with links.
 */
export function JobErrorStats() {
  const [open, setOpen] = useState(false);
  const [sinceDays, setSinceDays] = useState(14);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ErrorStatsResponse>({
    queryKey: ["job-error-stats", sinceDays],
    queryFn: () =>
      api.callResource("jobs", { action: "error_stats", sinceDays }),
    refetchInterval: 60000,
    // The heavy 5000-row feed is only fetched once the panel is opened.
    enabled: open,
  });

  const days = useMemo(() => lastDays(sinceDays), [sinceDays]);

  const groups = useMemo<ErrorGroup[]>(() => {
    if (!data?.failures) return [];
    const map = new Map<string, ErrorGroup>();
    for (const row of data.failures) {
      const key = classifyJobFailure(row.reason);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          rows: [],
          byType: new Map(),
          firstAt: Infinity,
          lastAt: 0,
          perDay: new Map(),
        };
        map.set(key, group);
      }
      group.rows.push(row);
      group.byType.set(row.type, (group.byType.get(row.type) ?? 0) + 1);
      const ts = row.timestamp ?? 0;
      if (ts) {
        group.firstAt = Math.min(group.firstAt, ts);
        group.lastAt = Math.max(group.lastAt, ts);
        const day = dayKey(ts);
        group.perDay.set(day, (group.perDay.get(day) ?? 0) + 1);
      }
    }
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [data]);

  const total = data?.failures.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            onClick={() => setOpen(!open)}
          >
            {open
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Failed jobs by error type
              {open && (
                <Badge variant={total > 0 ? "destructive" : "secondary"}>
                  {total}
                </Badge>
              )}
            </CardTitle>
          </button>
          {open && (
            <Select
              value={String(sinceDays)}
              onValueChange={(v) => setSinceDays(Number(v))}
            >
              <SelectTrigger className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {open && data?.truncated && (
          <p className="text-xs text-amber-500">
            Showing the 5000 most recent failures; narrow the window for exact
            counts.
          </p>
        )}
      </CardHeader>
      {open && (
      <CardContent className="space-y-1">
        {isLoading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {!isLoading && groups.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No failed jobs in the selected window.
          </div>
        )}
        {groups.map((group) => {
          const expanded = expandedGroup === group.key;
          return (
            <div key={group.key} className="rounded-md border">
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
                onClick={() => setExpandedGroup(expanded ? null : group.key)}
              >
                {expanded
                  ? <ChevronDown className="h-4 w-4 shrink-0" />
                  : <ChevronRight className="h-4 w-4 shrink-0" />}
                <Badge variant="outline" className="shrink-0 font-mono">
                  {group.rows.length}
                </Badge>
                <span
                  className="min-w-[10rem] flex-1 truncate text-sm font-medium"
                  title={group.key}
                >
                  {group.key}
                </span>
                <span className="hidden min-w-0 shrink truncate text-xs text-muted-foreground sm:block sm:max-w-[38%]">
                  {[...group.byType.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([t, n]) => `${t} ×${n}`)
                    .join(" · ")}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
                  last {format(new Date(group.lastAt), "MMM d HH:mm")}
                </span>
                <DayHistogram perDay={group.perDay} days={days} />
              </Button>
              {expanded && (
                <div className="max-h-64 space-y-1 overflow-y-auto border-t px-3 py-2">
                  {group.rows.slice(0, 100).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-baseline gap-2 text-xs"
                    >
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {row.timestamp
                          ? format(new Date(row.timestamp), "MMM d HH:mm")
                          : "—"}
                      </span>
                      <Badge
                        variant="secondary"
                        className="shrink-0 px-1.5 py-0"
                      >
                        {row.type}
                      </Badge>
                      <Link
                        to={`/jobs/${row.id}`}
                        className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground hover:underline"
                        title={row.reason}
                      >
                        {row.reason}
                      </Link>
                    </div>
                  ))}
                  {group.rows.length > 100 && (
                    <div className="text-xs text-muted-foreground">
                      …and {group.rows.length - 100} more
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
      )}
    </Card>
  );
}
