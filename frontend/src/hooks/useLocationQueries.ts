import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callResource } from "@/lib/api";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";
import type {
  ConversationMapGroup,
  GeonamesCity,
  LocationImport,
  LocationPointConflict,
  LocationSegment,
  LocationStatus,
  RecordedLocationTrack,
  SavedPlace,
} from "@/types/location";

export const locationKeys = {
  all: ["location"] as const,
  status: () => [...locationKeys.all, "status"] as const,
  segments: (start: number, end: number, maxPoints?: number) =>
    [...locationKeys.all, "segments", start, end, maxPoints] as const,
  at: (time: number) => [...locationKeys.all, "at", time] as const,
  forRange: (start: number, end: number) =>
    [...locationKeys.all, "forRange", start, end] as const,
  places: (query: string) => [...locationKeys.all, "places", query] as const,
  imports: () => [...locationKeys.all, "imports"] as const,
  savedPlaces: () => [...locationKeys.all, "savedPlaces"] as const,
  recordedTracks: () => [...locationKeys.all, "recordedTracks"] as const,
  conflicts: (status?: string) =>
    [...locationKeys.all, "conflicts", status ?? "all"] as const,
  geotags: (filters: Record<string, unknown>) =>
    [...locationKeys.all, "geotags", filters] as const,
  conversationsOnMap: (start?: number, end?: number) =>
    [
      ...locationKeys.all,
      "conversationsOnMap",
      start ?? "all",
      end ?? "all",
    ] as const,
};

export function useLocationStatus(enabled = true) {
  return useQuery<LocationStatus>({
    queryKey: locationKeys.status(),
    queryFn: () => callResource("location", { action: "status" }),
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useLocationSegments(
  start: Date | undefined,
  end: Date | undefined,
  options: { enabled?: boolean; maxPoints?: number; coalesceMs?: number } = {},
) {
  const { enabled = true, maxPoints, coalesceMs } = options;
  return useQuery<{
    segments: LocationSegment[];
    totalSegments: number;
  }>({
    queryKey: locationKeys.segments(
      start?.getTime() ?? 0,
      end?.getTime() ?? 0,
      maxPoints,
    ),
    queryFn: () =>
      callResource("location", {
        action: "list-segments",
        start,
        end,
        ...(maxPoints ? { maxPoints } : {}),
        ...(coalesceMs ? { coalesceMs } : {}),
      }),
    enabled: enabled && !!start && !!end,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useLocationAt(time: Date | undefined, enabled = true) {
  return useQuery<{
    segment: LocationSegment | null;
    point: { ts: Date | string; loc: { coordinates: [number, number] } } | null;
    place: LocationSegment["place"];
    timeZone: string | null;
  }>({
    queryKey: locationKeys.at(time?.getTime() ?? 0),
    queryFn: () => callResource("location", { action: "at", time }),
    enabled: enabled && !!time,
    staleTime: 60 * 1000,
  });
}

export function useLocationForRange(
  start: Date | undefined,
  end: Date | undefined,
  enabled = true,
) {
  return useQuery<{
    stays: LocationSegment[];
    primaryPlace: LocationSegment["place"];
    primaryStay: LocationSegment | null;
    coveragePct: number;
  }>({
    queryKey: locationKeys.forRange(start?.getTime() ?? 0, end?.getTime() ?? 0),
    queryFn: () =>
      callResource("location", { action: "for-range", start, end }),
    enabled: enabled && !!start && !!end,
    staleTime: 60 * 1000,
  });
}

export function usePlaceSearch(query: string, enabled = true) {
  return useQuery<GeonamesCity[]>({
    queryKey: locationKeys.places(query),
    queryFn: () =>
      callResource("location", { action: "search-places", query, limit: 10 }),
    enabled: enabled && query.trim().length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLocationImports(enabled = true) {
  return useQuery<LocationImport[]>({
    queryKey: locationKeys.imports(),
    queryFn: () => callResource("location", { action: "list-imports" }),
    enabled,
    staleTime: 15 * 1000,
  });
}

export function useSavedPlaces(enabled = true) {
  return useQuery<{ places: SavedPlace[]; total: number }>({
    queryKey: locationKeys.savedPlaces(),
    queryFn: () =>
      callResource("location", {
        action: "list-saved-places",
        limit: 2000,
        skip: 0,
      }),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useRecordedLocationTracks(enabled = true) {
  return useQuery<{ tracks: RecordedLocationTrack[]; total: number }>({
    queryKey: locationKeys.recordedTracks(),
    queryFn: () =>
      callResource("location", {
        action: "list-recorded-tracks",
        limit: 500,
        skip: 0,
      }),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useLocationConflicts(
  status: "pending" | "resolved" | undefined = "pending",
  enabled = true,
) {
  return useQuery<{ conflicts: LocationPointConflict[]; total: number }>({
    queryKey: locationKeys.conflicts(status),
    queryFn: () =>
      callResource("location", {
        action: "list-conflicts",
        ...(status ? { status } : {}),
        limit: 100,
        skip: 0,
      }),
    enabled,
    staleTime: 15 * 1000,
  });
}

export function useResolveLocationConflict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      resolution: "keep_existing" | "use_incoming" | "defer";
      candidateImportId?: string;
    }) => callResource("location", { action: "resolve-conflict", ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationKeys.all });
    },
  });
}

export function useConversationsOnMap(
  start: Date | undefined,
  end: Date | undefined,
  options: { enabled?: boolean; allTime?: boolean } = {},
) {
  const { enabled = true, allTime = false } = options;
  return useQuery<{
    groups: ConversationMapGroup[];
    unmatched: number;
    conversationCount: number;
  }>({
    queryKey: locationKeys.conversationsOnMap(
      allTime ? undefined : start?.getTime(),
      allTime ? undefined : end?.getTime(),
    ),
    queryFn: () =>
      callResource("location", {
        action: "conversations-on-map",
        ...(allTime ? {} : { start, end }),
      }),
    enabled: enabled && (allTime || (!!start && !!end)),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useGeotags(
  filters: {
    start?: Date;
    end?: Date;
    type?: string;
    importId?: string;
    limit?: number;
    skip?: number;
  },
  enabled = true,
) {
  return useQuery<{ segments: LocationSegment[]; total: number }>({
    queryKey: locationKeys.geotags({
      start: filters.start?.getTime(),
      end: filters.end?.getTime(),
      type: filters.type,
      importId: filters.importId,
      limit: filters.limit,
      skip: filters.skip,
    }),
    queryFn: () =>
      callResource("location", {
        action: "list-geotags",
        ...(filters.start && filters.end
          ? { start: filters.start, end: filters.end }
          : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.importId ? { importId: filters.importId } : {}),
        limit: filters.limit ?? 100,
        skip: filters.skip ?? 0,
      }),
    enabled,
    staleTime: 15 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useUpdateSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      start?: Date;
      end?: Date;
      place?: {
        geonameId?: number;
        name?: string;
        latitude?: number;
        longitude?: number;
      };
      timeZone?: string;
    }) => callResource("location", { action: "update-segment", ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationKeys.all });
    },
  });
}

export function useAssignManualLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      start: Date;
      end: Date;
      place: {
        geonameId?: number;
        name?: string;
        latitude?: number;
        longitude?: number;
      };
      timeZone?: string;
    }) => callResource("location", { action: "assign-manual", ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationKeys.all });
    },
  });
}

export function useDeleteLocationSegment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callResource("location", { action: "delete-segment", id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationKeys.all });
    },
  });
}

export function useDeleteLocationImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callResource("location", { action: "delete-import", id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: locationKeys.all });
    },
  });
}

/** Invalidate location queries when segments change server-side. */
export function useLocationLiveUpdates(enabled = true) {
  const queryClient = useQueryClient();
  useWebSocketSubscription(
    "mongo:location_segments",
    () => {
      queryClient.invalidateQueries({ queryKey: locationKeys.all });
    },
    enabled,
  );
}
