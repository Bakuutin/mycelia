import { useEffect, useId, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarRange, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  calendarDateInTimeZone,
  type DatePickerPrecision,
  type DateRangeValue,
  formatPickerDuration,
  formatPickerRange,
  isValidPickerDate,
  pickerTimeZoneLabel,
  replaceZonedCalendarDate,
  replaceZonedTime,
  zonedTimeInputValue,
} from "@/lib/datePicker";
import { resolveDefaultTimeZone } from "@/lib/timeZones";
import { useSettingsStore } from "@/stores/settingsStore";
import { useHistogramItems } from "@/modules/histogram/useHistogramItems";
import { cn } from "@/lib/utils";

type DateRangePickerProps = {
  value?: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  allowOpenEnd?: boolean;
  precision?: DatePickerPrecision;
  timeZone?: string;
  minDate?: Date;
  maxDate?: Date;
  maxDurationMs?: number;
  showAudioTimeline?: boolean;
  className?: string;
};

function useDesktopCalendar(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ||
    window.matchMedia("(min-width: 640px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return desktop;
}

function closestAvailableBoundary(
  timestamp: number,
  candidates: number[],
): number {
  if (candidates.length === 0) return timestamp;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - timestamp) < Math.abs(best - timestamp)
      ? candidate
      : best
  );
}

function AudioRangeTimeline({
  domain,
  value,
  onChange,
  precision,
  timeZone,
}: {
  domain: { start: Date; end: Date };
  value: { start: Date; end: Date };
  onChange: (value: { start: Date; end: Date }) => void;
  precision: Exclude<DatePickerPrecision, "date">;
  timeZone: string;
}) {
  const { items } = useHistogramItems(domain.start, domain.end);
  const [sliderValue, setSliderValue] = useState([
    value.start.getTime(),
    value.end.getTime(),
  ]);
  const domainStart = domain.start.getTime();
  const domainEnd = domain.end.getTime();
  const domainDuration = Math.max(1, domainEnd - domainStart);

  useEffect(() => {
    setSliderValue([value.start.getTime(), value.end.getTime()]);
  }, [value.start, value.end]);

  const available = useMemo(
    () =>
      items.filter((item) =>
        item.start.getTime() < domainEnd && item.end.getTime() > domainStart &&
        (item.totals.audio_chunks?.count ?? 0) > 0
      ),
    [items, domainEnd, domainStart],
  );
  const maxCount = Math.max(
    1,
    ...available.map((item) => item.totals.audio_chunks?.count ?? 0),
  );

  const commit = (next: number[]) => {
    const starts = available.map((item) => item.start.getTime());
    const ends = available.map((item) => item.end.getTime());
    const snappedStart = closestAvailableBoundary(next[0], starts);
    const snappedEnd = closestAvailableBoundary(next[1], ends);
    if (snappedEnd <= snappedStart) return;
    onChange({ start: new Date(snappedStart), end: new Date(snappedEnd) });
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm">Timeline range</Label>
        <span className="text-xs text-muted-foreground">
          Drag an edge; it snaps to available audio
        </span>
      </div>
      <div className="relative h-16 overflow-hidden rounded-md bg-muted/40 px-2 pt-2">
        <div className="absolute inset-x-2 bottom-5 top-2">
          {available.map((item) => {
            const start = Math.max(item.start.getTime(), domainStart);
            const end = Math.min(item.end.getTime(), domainEnd);
            const count = item.totals.audio_chunks?.count ?? 0;
            return (
              <span
                key={item.id}
                className="absolute bottom-0 min-w-px rounded-t-sm bg-primary/55"
                style={{
                  left: `${((start - domainStart) / domainDuration) * 100}%`,
                  width: `${
                    Math.max(0.2, ((end - start) / domainDuration) * 100)
                  }%`,
                  height: `${Math.max(10, (count / maxCount) * 100)}%`,
                }}
              />
            );
          })}
          {available.length === 0 && (
            <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              No indexed audio in this period
            </span>
          )}
        </div>
        <Slider
          className="absolute inset-x-2 bottom-2 w-auto"
          min={domainStart}
          max={domainEnd}
          step={precision === "second" ? 1_000 : 60_000}
          minStepsBetweenThumbs={1}
          value={sliderValue}
          onValueChange={setSliderValue}
          onValueCommit={commit}
          thumbLabels={["Range start", "Range end"]}
          aria-label="Selected audio range"
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>
          {formatPickerRange({ start: domain.start }, timeZone, precision)}
        </span>
        <span>
          {formatPickerRange({ start: domain.end }, timeZone, precision)}
        </span>
      </div>
    </div>
  );
}

export function DateRangePicker({
  value,
  onChange,
  label,
  placeholder = "Choose a range",
  disabled = false,
  allowOpenEnd = false,
  precision = "minute",
  timeZone: requestedTimeZone,
  minDate,
  maxDate,
  maxDurationMs,
  showAudioTimeline = false,
  className,
}: DateRangePickerProps) {
  const defaultTimeZone = useSettingsStore((state) => state.defaultTimeZone);
  const timeZone = requestedTimeZone ?? resolveDefaultTimeZone(defaultTimeZone);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRangeValue>(() =>
    value ?? {
      start: new Date(Date.now() - 86_400_000),
      end: new Date(),
    }
  );
  const [timelineDomain, setTimelineDomain] = useState<
    {
      start: Date;
      end: Date;
    } | null
  >(value?.end ? { start: value.start, end: value.end } : null);
  const desktopCalendar = useDesktopCalendar();
  const id = useId();

  useEffect(() => {
    if (!open && value) setDraft(value);
  }, [open, value]);

  const selected: DateRange = {
    from: isValidPickerDate(draft.start)
      ? calendarDateInTimeZone(draft.start, timeZone)
      : undefined,
    to: isValidPickerDate(draft.end)
      ? calendarDateInTimeZone(draft.end, timeZone)
      : undefined,
  };
  const duration = value ? formatPickerDuration(value, precision) : null;
  const draftError = (() => {
    if (!isValidPickerDate(draft.start)) return "Choose a start date.";
    if (!draft.end) return allowOpenEnd ? null : "Choose the finish date.";
    if (!isValidPickerDate(draft.end)) return "Choose a valid finish date.";
    const difference = draft.end.getTime() - draft.start.getTime();
    if (precision === "date" ? difference < 0 : difference <= 0) {
      return "The finish must be after the start.";
    }
    if (maxDurationMs != null && difference > maxDurationMs) {
      return `This range is longer than the allowed ${
        Math.round(maxDurationMs / 3_600_000)
      } hours.`;
    }
    return null;
  })();

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const nextDraft = value ?? {
        start: new Date(Date.now() - 86_400_000),
        end: new Date(),
      };
      setDraft(nextDraft);
      setTimelineDomain(
        nextDraft.end ? { start: nextDraft.start, end: nextDraft.end } : null,
      );
    }
    setOpen(nextOpen);
  };

  const handleCalendarSelect = (next: DateRange | undefined) => {
    if (!next?.from) return;
    const nextStart = replaceZonedCalendarDate(
      draft.start ?? new Date(),
      next.from,
      timeZone,
      precision,
    );
    const nextEnd = next.to
      ? replaceZonedCalendarDate(
        draft.end ?? draft.start ?? new Date(),
        next.to,
        timeZone,
        precision,
      )
      : undefined;
    const nextDraft = { start: nextStart, end: nextEnd };
    setDraft(nextDraft);
    if (nextEnd) setTimelineDomain({ start: nextStart, end: nextEnd });
  };

  const apply = () => {
    if (draftError) return;
    onChange(draft);
    setOpen(false);
  };

  const displayValue = value && isValidPickerDate(value.start)
    ? formatPickerRange(value, timeZone, precision)
    : placeholder;

  return (
    <div className={cn("space-y-2", className)}>
      {label && <Label htmlFor={`${id}-trigger`}>{label}</Label>}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            id={`${id}-trigger`}
            type="button"
            variant="outline"
            disabled={disabled}
            className="h-auto min-h-10 w-full justify-start gap-2 whitespace-normal px-3 py-2 text-left font-normal"
          >
            <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">{displayValue}</span>
            {duration && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {duration}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-[var(--radix-popover-content-available-height)] w-[min(calc(100vw-2rem),44rem)] overflow-y-auto p-0"
        >
          <div className="space-y-3 p-3">
            <Calendar
              mode="range"
              selected={selected}
              onSelect={handleCalendarSelect}
              numberOfMonths={desktopCalendar ? 2 : 1}
              captionLayout="dropdown"
              defaultMonth={selected.from}
              startMonth={minDate ?? new Date(1900, 0, 1)}
              endMonth={maxDate ??
                new Date(new Date().getFullYear() + 20, 11, 31)}
              disabled={minDate && maxDate
                ? [{ before: minDate }, { after: maxDate }]
                : minDate
                ? { before: minDate }
                : maxDate
                ? { after: maxDate }
                : undefined}
              classNames={{
                months: desktopCalendar
                  ? "relative flex flex-row gap-4"
                  : "relative flex flex-col gap-4",
                month: "flex min-w-0 flex-1 flex-col gap-4",
              }}
              className="mx-auto [--cell-size:2.25rem]"
            />

            {precision !== "date" && (
              <div className="space-y-2 border-t pt-3">
                <Label>Exact time</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Start
                    <Input
                      type="time"
                      step={precision === "second" ? 1 : 60}
                      value={zonedTimeInputValue(
                        draft.start,
                        timeZone,
                        precision,
                      )}
                      onChange={(event) => {
                        const next = replaceZonedTime(
                          draft.start,
                          event.target.value,
                          timeZone,
                          precision,
                        );
                        if (next) {
                          setDraft((current) => ({ ...current, start: next }));
                        }
                      }}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    End
                    <Input
                      type="time"
                      step={precision === "second" ? 1 : 60}
                      disabled={!draft.end}
                      value={draft.end
                        ? zonedTimeInputValue(draft.end, timeZone, precision)
                        : ""}
                      onChange={(event) => {
                        if (!draft.end) {
                          return;
                        }
                        const next = replaceZonedTime(
                          draft.end,
                          event.target.value,
                          timeZone,
                          precision,
                        );
                        if (next) {
                          setDraft((current) => ({ ...current, end: next }));
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {showAudioTimeline && precision !== "date" && draft.end &&
              timelineDomain && (
              <AudioRangeTimeline
                domain={timelineDomain}
                value={{ start: draft.start, end: draft.end }}
                onChange={(next) => setDraft(next)}
                precision={precision}
                timeZone={timeZone}
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">
                {pickerTimeZoneLabel(draft.start, timeZone)}
              </span>
              <div className="flex items-center gap-2">
                {allowOpenEnd && draft.end && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft((current) => ({ ...current, end: undefined }))}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    No finish
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={apply}
                  disabled={Boolean(draftError)}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Apply range
                </Button>
              </div>
            </div>
            {draftError && (
              <p className="text-xs text-destructive">{draftError}</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
