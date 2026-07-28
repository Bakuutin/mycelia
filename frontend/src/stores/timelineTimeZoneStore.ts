import { create } from "zustand";
import { callResource } from "@/lib/api";
import { getPeriodId, type TimelineTimeZonePeriod } from "@/lib/timeZones";

interface CreateTimelineTimeZonePeriod {
  start: Date;
  end: Date;
  timeZone: string;
  location?: { name?: string; latitude?: number; longitude?: number };
  source?: "manual" | "import" | "metadata";
  metadata?: Record<string, unknown>;
}

interface TimelineTimeZoneState {
  periods: TimelineTimeZonePeriod[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  requestedRange: { start: number; end: number } | null;
  fetchForRange: (start: Date, end: Date) => Promise<void>;
  createPeriod: (
    period: CreateTimelineTimeZonePeriod,
  ) => Promise<TimelineTimeZonePeriod>;
  deletePeriod: (id: string) => Promise<void>;
}

export const useTimelineTimeZoneStore = create<TimelineTimeZoneState>(
  (set, get) => ({
    periods: [],
    loading: false,
    saving: false,
    error: null,
    requestedRange: null,

    fetchForRange: async (start, end) => {
      const request = { start: start.getTime(), end: end.getTime() };
      const current = get().requestedRange;
      if (current?.start === request.start && current.end === request.end) {
        return;
      }

      set({ loading: true, error: null, requestedRange: request });
      try {
        const periods = await callResource("timeline-timezones", {
          action: "list",
          start,
          end,
        });
        set({ periods, loading: false });
      } catch (error) {
        set({
          error: error instanceof Error
            ? error.message
            : "Failed to load time zones",
          loading: false,
        });
      }
    },

    createPeriod: async (period) => {
      set({ saving: true, error: null });
      try {
        const normalizedPeriod = {
          ...period,
          ...(period.location ? { location: period.location } : {}),
          source: period.source ?? "manual",
        };
        if (!period.location) delete normalizedPeriod.location;
        const created = await callResource("timeline-timezones", {
          action: "create",
          period: normalizedPeriod,
        }) as TimelineTimeZonePeriod;
        set((state) => ({
          periods: [...state.periods, created].sort(
            (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
          ),
          saving: false,
        }));
        return created;
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Failed to save time zone";
        set({ error: message, saving: false });
        throw error;
      }
    },

    deletePeriod: async (id) => {
      set({ saving: true, error: null });
      try {
        await callResource("timeline-timezones", { action: "delete", id });
        set((state) => ({
          periods: state.periods.filter((period) => getPeriodId(period) !== id),
          saving: false,
        }));
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Failed to delete time zone";
        set({ error: message, saving: false });
        throw error;
      }
    },
  }),
);
