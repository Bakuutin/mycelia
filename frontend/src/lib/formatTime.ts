import { type TimeFormat, useSettingsStore } from "@/stores/settingsStore";
import { formatDuration } from "@/modules/time/formatters/si";

export function formatTime(date: Date | string | number, format?: TimeFormat): string {
  // Tolerate ISO strings / epoch numbers from malformed or serialized data —
  // a bad value must not crash the whole page with "getTime is not a function"
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  if (!date || isNaN(date.getTime())) {
    return "N/A";
  }

  const actualFormat = format || useSettingsStore.getState().timeFormat;

  switch (actualFormat) {
    case "gregorian-local-natural":
      return date.toLocaleString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

    case "gregorian-local-iso":
      return date.toLocaleString("sv-SE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }).replace(" ", "T");

    case "gregorian-local-verbose":
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZoneName: "short",
      });

    case "gregorian-local-european":
      // en-GB yields dd/mm/yyyy; the ISO-style rendering already exists as
      // gregorian-local-iso (sv-SE).
      return date.toLocaleString("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZoneName: "short",
      });

    case "gregorian-local-american":
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZoneName: "short",
      });

    case "gregorian-utc-iso":
      return date.toISOString();

    case "gregorian-utc-verbose": {
      const utcDate = new Date(date.toISOString());
      return utcDate.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZoneName: "short",
      }) + " UTC";
    }

    case "gregorian-utc-european": {
      const utcDate = new Date(date.toISOString());
      return utcDate.toLocaleString("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }) + " UTC";
    }

    case "gregorian-utc-american": {
      const utcDate = new Date(date.toISOString());
      return utcDate.toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "UTC",
      }) + " UTC";
    }

    case "si-int": {
      const seconds = Math.floor(date.getTime() / 1000);
      return seconds.toLocaleString("en-US");
    }

    case "si-formatted": {
      const segments = formatDuration(date.getTime());
      return segments.join(" ");
    }

    default:
      return date.toISOString();
  }
}

export function useFormattedTime(date: Date): string {
  const { timeFormat } = useSettingsStore();
  return formatTime(date, timeFormat);
}

export function formatTimeRangeCount(count: number): string {
  return `${count} time range${count !== 1 ? "s" : ""}`;
}

/**
 * Format a date as a user-friendly relative time string
 * e.g., "just now", "5m ago", "2h ago", "yesterday", "Mon", "Jan 15"
 */
export function formatRelativeTime(date: Date): string {
  if (!date || isNaN(date.getTime())) {
    return "N/A";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  // Just now (less than 1 minute)
  if (diffSec < 60) {
    return "just now";
  }

  // Minutes ago (less than 1 hour)
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  // Hours ago (less than 24 hours)
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "yesterday";
  }

  // This week (show days ago)
  if (diffDay < 7) {
    return `${diffDay}d ago`;
  }

  // This year (show month and day)
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Older (show month, day, and year)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatTimeRangeDuration(start: Date, end: Date): string {
  const durationMs = end.getTime() - start.getTime();
  const timeFormat = useSettingsStore.getState().timeFormat;

  if (timeFormat === "si-int" || timeFormat === "si-formatted") {
    const segments = formatDuration(durationMs);
    return segments.join(" ");
  }

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (weeks > 0) return `${weeks}w`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  if (seconds > 0) return `${seconds}s`;
  return "0s";
}
