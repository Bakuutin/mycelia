import { type TimeFormat, useSettingsStore } from "@/stores/settingsStore";
import { formatDuration } from "@/modules/time/formatters/si";

export function formatTime(date: Date, format?: TimeFormat): string {
  const actualFormat = format || useSettingsStore.getState().timeFormat;

  switch (actualFormat) {
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
      return date.toLocaleString("sv-SE", {
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
