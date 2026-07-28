import { useMemo } from "react";
import {
  BROWSER_TIME_ZONE,
  getBrowserTimeZone,
  getSupportedTimeZones,
} from "@/lib/timeZones";

interface TimeZoneSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  includeBrowser?: boolean;
  className?: string;
  disabled?: boolean;
}

export function TimeZoneSelect({
  id,
  value,
  onChange,
  includeBrowser = false,
  className = "",
  disabled = false,
}: TimeZoneSelectProps) {
  const timeZones = useMemo(getSupportedTimeZones, []);
  const browserTimeZone = getBrowserTimeZone();

  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {includeBrowser && (
        <option value={BROWSER_TIME_ZONE}>
          Current device ({browserTimeZone})
        </option>
      )}
      {timeZones.map((timeZone) => (
        <option key={timeZone} value={timeZone}>{timeZone}</option>
      ))}
    </select>
  );
}
