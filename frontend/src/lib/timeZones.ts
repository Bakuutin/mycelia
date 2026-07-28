export const BROWSER_TIME_ZONE = "browser" as const;

export type DefaultTimeZone = typeof BROWSER_TIME_ZONE | string;

export interface TimelineTimeZonePeriod {
  _id: { toString(): string } | string;
  start: Date;
  end: Date;
  timeZone: string;
  location?: {
    name?: string;
    latitude?: number;
    longitude?: number;
  };
  source: "manual" | "import" | "metadata";
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function resolveDefaultTimeZone(timeZone: DefaultTimeZone): string {
  return timeZone === BROWSER_TIME_ZONE ? getBrowserTimeZone() : timeZone;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

const FALLBACK_TIME_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Moscow",
  "Asia/Tbilisi",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const TIME_ZONE_CITY_ALIASES: Record<string, string[]> = {
  "America/Los_Angeles": ["San Francisco", "San Diego", "Seattle"],
  "America/New_York": ["Boston", "Miami", "Washington DC"],
  "America/Toronto": ["Ottawa"],
  "America/Mexico_City": ["Mexico City"],
  "America/Sao_Paulo": ["São Paulo"],
  "Europe/London": ["Belfast", "Edinburgh", "Manchester"],
  "Europe/Paris": ["Metz", "Nancy", "Lyon", "Strasbourg"],
  "Europe/Berlin": ["Hamburg", "Munich", "Frankfurt"],
  "Europe/Amsterdam": ["Rotterdam", "The Hague"],
  "Europe/Moscow": ["Saint Petersburg"],
  "Asia/Tbilisi": ["Batumi", "Kutaisi"],
  "Asia/Dubai": ["Abu Dhabi"],
  "Asia/Calcutta": ["Kolkata", "Delhi", "Mumbai", "Bengaluru"],
  "Asia/Kolkata": ["Delhi", "Mumbai", "Bengaluru"],
  "Asia/Bangkok": ["Chiang Mai", "Phuket"],
  "Asia/Tokyo": ["Osaka", "Kyoto"],
  "Australia/Sydney": ["Canberra"],
  "Pacific/Auckland": ["Wellington"],
};

export interface TimeZoneSearchOption {
  timeZone: string;
  city: string;
  aliases: string[];
  searchValue: string;
}

function humanizeTimeZonePart(value: string): string {
  return value.replaceAll("_", " ");
}

export function getTimeZoneSearchOptions(): TimeZoneSearchOption[] {
  return getSupportedTimeZones().map((timeZone) => {
    const parts = timeZone.split("/");
    const city = timeZone === "UTC"
      ? "UTC"
      : humanizeTimeZonePart(parts.at(-1) ?? timeZone);
    const region = parts.length > 1 ? humanizeTimeZonePart(parts[0]) : "";
    const aliases = TIME_ZONE_CITY_ALIASES[timeZone] ?? [];
    return {
      timeZone,
      city,
      aliases,
      searchValue: [city, timeZone, region, ...aliases].join(" "),
    };
  });
}

export function getSupportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const values = intl.supportedValuesOf?.("timeZone") ?? FALLBACK_TIME_ZONES;
  return [...new Set(["UTC", ...values])].sort((a, b) => a.localeCompare(b));
}

export function getPeriodId(period: TimelineTimeZonePeriod): string {
  return typeof period._id === "string" ? period._id : period._id.toString();
}

export function findTimeZonePeriod(
  periods: TimelineTimeZonePeriod[],
  instant: Date,
): TimelineTimeZonePeriod | undefined {
  const timestamp = instant.getTime();
  return [...periods].reverse().find((period) =>
    new Date(period.start).getTime() <= timestamp &&
    timestamp < new Date(period.end).getTime()
  );
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getZonedDateParts(
  date: Date,
  timeZone: string,
): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [
      part.type,
      Number(part.value),
    ]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedDateParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedDateTimeToUtc(
  parts:
    & Omit<ZonedDateParts, "hour" | "minute" | "second">
    & Partial<Pick<ZonedDateParts, "hour" | "minute" | "second">>,
  timeZone: string,
): Date {
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  let candidate = new Date(wallClockUtc);
  for (let attempt = 0; attempt < 3; attempt++) {
    candidate = new Date(
      wallClockUtc - getTimeZoneOffsetMs(candidate, timeZone),
    );
  }
  return candidate;
}

function shiftCalendarDate(
  parts: Pick<ZonedDateParts, "year" | "month" | "day">,
  days: number,
) {
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export type TimelinePreset =
  | "last5min"
  | "lastHour"
  | "today"
  | "yesterday"
  | "thisWeek"
  | "currentMonth"
  | "yearToDate"
  | "pastYear";

export function getTimelinePresetRange(
  preset: TimelinePreset,
  now: Date,
  timeZone: string,
): { start: Date; end: Date } {
  if (preset === "last5min") {
    return { start: new Date(now.getTime() - 5 * 60_000), end: now };
  }
  if (preset === "lastHour") {
    return { start: new Date(now.getTime() - 60 * 60_000), end: now };
  }
  if (preset === "pastYear") {
    return {
      start: new Date(now.getTime() - 365 * 24 * 60 * 60_000),
      end: now,
    };
  }

  const today = getZonedDateParts(now, timeZone);
  const todayDate = { year: today.year, month: today.month, day: today.day };
  const todayStart = zonedDateTimeToUtc(todayDate, timeZone);

  if (preset === "today") return { start: todayStart, end: now };
  if (preset === "yesterday") {
    return {
      start: zonedDateTimeToUtc(shiftCalendarDate(todayDate, -1), timeZone),
      end: todayStart,
    };
  }
  if (preset === "currentMonth") {
    return {
      start: zonedDateTimeToUtc({ ...todayDate, day: 1 }, timeZone),
      end: now,
    };
  }
  if (preset === "yearToDate") {
    return {
      start: zonedDateTimeToUtc(
        { year: today.year, month: 1, day: 1 },
        timeZone,
      ),
      end: now,
    };
  }

  const dayOfWeek = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  ).getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return {
    start: zonedDateTimeToUtc(
      shiftCalendarDate(todayDate, mondayOffset),
      timeZone,
    ),
    end: now,
  };
}

export function getShortTimeZoneName(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date).find((item) => item.type === "timeZoneName");
  return part?.value ?? timeZone;
}

export function isSameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  const first = getZonedDateParts(a, timeZone);
  const second = getZonedDateParts(b, timeZone);
  return first.year === second.year && first.month === second.month &&
    first.day === second.day;
}
