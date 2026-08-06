import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarRange, FileSearch } from "lucide-react";
import { useObject } from "@/hooks/useObjectQueries";
import { IconDisplay } from "@/components/IconDisplay";
import { formatTime } from "@/lib/formatTime";
import { cn } from "@/lib/utils";

const chipClasses =
  "inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/60 " +
  "px-2 py-0.5 align-middle text-xs font-medium text-foreground no-underline " +
  "transition-colors hover:bg-muted cursor-pointer";

function ChipLink(
  { to, children, title, className }: {
    to: string;
    children: ReactNode;
    title?: string;
    className?: string;
  },
) {
  const navigate = useNavigate();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Keep cmd/ctrl-click (new tab) working; intercept plain clicks for SPA nav
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return (
    <a
      href={to}
      onClick={handleClick}
      title={title}
      className={cn(chipClasses, className)}
    >
      {children}
    </a>
  );
}

/**
 * Inline chip for an object link (/objects/:id). Fetches the object to show
 * its icon and canonical name; falls back to the link text while loading or
 * if the object cannot be fetched.
 */
export function ObjectChip(
  { id, fallbackLabel }: { id: string; fallbackLabel?: string },
) {
  const { data: object } = useObject(id);
  const label = object?.name ?? fallbackLabel ?? id.slice(0, 8);

  return (
    <ChipLink to={`/objects/${id}`} title={object?.details ?? label}>
      <IconDisplay
        icon={object?.icon}
        fallback="🔗"
        className="text-xs leading-none"
      />
      <span className="truncate">{label}</span>
    </ChipLink>
  );
}

function formatRangeLabel(href: string): string | undefined {
  try {
    const query = new URLSearchParams(href.split("?")[1] ?? "");
    const start = Number(query.get("start"));
    const end = Number(query.get("end"));
    if (!Number.isFinite(start)) return undefined;
    const startLabel = formatTime(new Date(start));
    if (!Number.isFinite(end)) return startLabel;
    return `${startLabel} – ${formatTime(new Date(end))}`;
  } catch {
    return undefined;
  }
}

/**
 * Inline chip for a time-range link (/timeline?start=&end= or
 * /transcript?start=&end=&q=). Shows a formatted range when the label is
 * generic, otherwise keeps the model-provided label.
 */
export function TimeRangeChip(
  { href, label }: { href: string; label?: string },
) {
  const isTranscript = href.startsWith("/transcript");
  const rangeLabel = formatRangeLabel(href);
  const display = label?.trim() || rangeLabel || (isTranscript ? "Transcript" : "Timeline");

  return (
    <ChipLink to={href} title={rangeLabel ?? display}>
      {isTranscript
        ? <FileSearch className="size-3 shrink-0" />
        : <CalendarRange className="size-3 shrink-0" />}
      <span className="truncate">{display}</span>
    </ChipLink>
  );
}
