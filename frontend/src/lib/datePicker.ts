import {
  getShortTimeZoneName,
  getZonedDateParts,
  zonedDateTimeToUtc,
} from "@/lib/timeZones";

export type DatePickerPrecision = "date" | "minute" | "second";

export type DateRangeValue = {
  start: Date;
  end?: Date;
};

export function zonedDateKey(date: Date, timeZone: string): string {
  const parts = getZonedDateParts(date, timeZone);
  return [parts.year, parts.month, parts.day]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

export function zonedDateKeyToDate(
  value: string,
  timeZone: string,
): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = zonedDateTimeToUtc({ year, month, day }, timeZone);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isValidPickerDate(
  value: Date | undefined | null,
): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function calendarDateInTimeZone(date: Date, timeZone: string): Date {
  const parts = getZonedDateParts(date, timeZone);
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function replaceZonedCalendarDate(
  current: Date,
  calendarDate: Date,
  timeZone: string,
  precision: DatePickerPrecision,
): Date {
  const currentParts = getZonedDateParts(current, timeZone);
  return zonedDateTimeToUtc({
    year: calendarDate.getFullYear(),
    month: calendarDate.getMonth() + 1,
    day: calendarDate.getDate(),
    hour: precision === "date" ? 0 : currentParts.hour,
    minute: precision === "date" ? 0 : currentParts.minute,
    second: precision === "second" ? currentParts.second : 0,
  }, timeZone);
}

export function zonedTimeInputValue(
  date: Date,
  timeZone: string,
  precision: Exclude<DatePickerPrecision, "date">,
): string {
  const parts = getZonedDateParts(date, timeZone);
  const base = [parts.hour, parts.minute]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return precision === "second"
    ? [base, String(parts.second).padStart(2, "0")].join(":")
    : base;
}

export function replaceZonedTime(
  current: Date,
  value: string,
  timeZone: string,
  precision: Exclude<DatePickerPrecision, "date">,
): Date | null {
  const [hour, minute, parsedSecond] = value.split(":").map(Number);
  if (
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59
  ) {
    return null;
  }
  const second = precision === "second" ? parsedSecond : 0;
  if (!Number.isInteger(second) || second < 0 || second > 59) return null;
  const parts = getZonedDateParts(current, timeZone);
  return zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute,
    second,
  }, timeZone);
}

function formatDateOnly(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatPickerDateTime(
  date: Date,
  timeZone: string,
  precision: DatePickerPrecision,
): string {
  if (precision === "date") return formatDateOnly(date, timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: precision === "second" ? "2-digit" : undefined,
  }).format(date);
}

export function formatPickerRange(
  value: DateRangeValue,
  timeZone: string,
  precision: DatePickerPrecision,
): string {
  const start = formatPickerDateTime(value.start, timeZone, precision);
  if (!value.end) return start;
  return `${start} → ${formatPickerDateTime(value.end, timeZone, precision)}`;
}

export function pickerTimeZoneLabel(date: Date, timeZone: string): string {
  const shortName = getShortTimeZoneName(date, timeZone);
  return shortName === timeZone ? timeZone : `${timeZone} · ${shortName}`;
}

export function formatPickerDuration(
  value: DateRangeValue,
  precision: DatePickerPrecision,
): string | null {
  if (!value.end) return null;
  const durationMs = value.end.getTime() - value.start.getTime();
  if (precision === "date") {
    const days = Math.max(1, Math.round(durationMs / 86_400_000) + 1);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (durationMs < 0) return null;
  const seconds = Math.floor(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
