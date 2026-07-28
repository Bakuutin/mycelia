import { useCallback, useMemo } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTimelineTimeZoneStore } from "@/stores/timelineTimeZoneStore";
import {
  findTimeZonePeriod,
  getBrowserTimeZone,
  resolveDefaultTimeZone,
} from "@/lib/timeZones";

export function useTimelineTimeZone() {
  const defaultTimeZone = useSettingsStore((state) => state.defaultTimeZone);
  const mode = useSettingsStore((state) => state.timelineTimeZoneMode);
  const override = useSettingsStore(
    (state) => state.timelineTimeZoneOverride,
  );
  const periods = useTimelineTimeZoneStore((state) => state.periods);
  const browserTimeZone = getBrowserTimeZone();
  const fallbackTimeZone = resolveDefaultTimeZone(defaultTimeZone);

  const fixedTimeZone = mode === "browser"
    ? browserTimeZone
    : mode === "fixed"
    ? override
    : fallbackTimeZone;

  const resolveTimeZone = useCallback(
    (instant: Date) => {
      if (mode !== "contextual") return fixedTimeZone;
      return findTimeZonePeriod(periods, instant)?.timeZone ?? fallbackTimeZone;
    },
    [fallbackTimeZone, fixedTimeZone, mode, periods],
  );

  const activeTimeZone = useMemo(
    () => resolveTimeZone(new Date()),
    [resolveTimeZone],
  );

  return {
    mode,
    periods,
    browserTimeZone,
    fallbackTimeZone,
    fixedTimeZone,
    activeTimeZone,
    resolveTimeZone,
  };
}
