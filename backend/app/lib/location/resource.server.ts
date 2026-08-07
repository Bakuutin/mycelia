import { ObjectId } from "bson";
import { z } from "zod";
import tzLookup from "tz-lookup";
import { type Auth } from "@/lib/auth/core.server.ts";
import { type Resource } from "@/lib/auth/resources.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getJobsResource } from "@/lib/resources/worker.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";

const SEGMENTS = "location_segments";
const POINTS = "location_points";
const IMPORTS = "location_imports";
const GEONAMES = "geonames_cities";
const TZ_PERIODS = "timeline_timezone_periods";

/** Window padding used when re-running processing around an edit. */
const REPROCESS_PAD_MS = 6 * 60 * 60 * 1000;

const listSegmentsSchema = z.object({
  action: z.literal("list-segments"),
  start: zDateOrString(),
  end: zDateOrString(),
  maxPoints: z.number().int().min(100).max(50000).default(5000),
  coalesceMs: z.number().min(0).optional(),
});

const atSchema = z.object({
  action: z.literal("at"),
  time: zDateOrString(),
});

const forRangeSchema = z.object({
  action: z.literal("for-range"),
  start: zDateOrString(),
  end: zDateOrString(),
});

const searchPlacesSchema = z.object({
  action: z.literal("search-places"),
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

const assignManualSchema = z.object({
  action: z.literal("assign-manual"),
  start: zDateOrString(),
  end: zDateOrString(),
  place: z.object({
    geonameId: z.number().optional(),
    name: z.string().trim().min(1).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }),
  timeZone: z.string().optional(),
}).refine((v) => v.end.getTime() > v.start.getTime(), {
  message: "Range end must be after its start",
  path: ["end"],
}).refine(
  (v) =>
    v.place.geonameId !== undefined ||
    (v.place.latitude !== undefined && v.place.longitude !== undefined),
  { message: "Provide either a geonameId or latitude+longitude" },
);

const deleteSegmentSchema = z.object({
  action: z.literal("delete-segment"),
  id: z.string().refine(ObjectId.isValid, "Invalid segment id"),
});

const conversationsOnMapSchema = z.object({
  action: z.literal("conversations-on-map"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
});

const statusSchema = z.object({
  action: z.literal("status"),
});

const listImportsSchema = z.object({
  action: z.literal("list-imports"),
});

const deleteImportSchema = z.object({
  action: z.literal("delete-import"),
  id: z.string().refine(ObjectId.isValid, "Invalid import id"),
});

export const locationRequestSchema = z.discriminatedUnion("action", [
  listSegmentsSchema,
  atSchema,
  forRangeSchema,
  searchPlacesSchema,
  assignManualSchema,
  deleteSegmentSchema,
  conversationsOnMapSchema,
  statusSchema,
  listImportsSchema,
  deleteImportSchema,
]);

export type LocationRequest = z.input<typeof locationRequestSchema>;
export type LocationResponse = unknown;

function decimatePath(
  path: [number, number][],
  budget: number,
): [number, number][] {
  if (path.length <= budget || path.length <= 2) return path;
  const result: [number, number][] = [path[0]];
  const stride = (path.length - 1) / (budget - 1);
  for (let i = 1; i < budget - 1; i++) {
    result.push(path[Math.round(i * stride)]);
  }
  result.push(path[path.length - 1]);
  return result;
}

function overlapMs(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number {
  return Math.max(
    0,
    Math.min(aEnd.getTime(), bEnd.getTime()) -
      Math.max(aStart.getTime(), bStart.getTime()),
  );
}

export class LocationResource
  implements Resource<LocationRequest, LocationResponse> {
  code = "location";
  description =
    "Location tracks: derived stay/move/gap segments, offline reverse geocoding, manual range assignments and map queries";
  schemas = {
    request: locationRequestSchema,
    response: z.any(),
  };

  extractActions(input: LocationRequest) {
    return [{
      path: ["location"],
      actions: [input.action],
    }];
  }

  async use(rawInput: LocationRequest, auth: Auth): Promise<LocationResponse> {
    const input = locationRequestSchema.parse(rawInput);
    const mongo = await getMongoResource(auth);

    switch (input.action) {
      case "list-segments": {
        const segments: any[] = await mongo({
          action: "find",
          collection: SEGMENTS,
          query: { start: { $lt: input.end }, end: { $gt: input.start } },
          options: { sort: { start: 1 } },
        });

        const rangeMs = input.end.getTime() - input.start.getTime();
        const minVisibleMs = input.coalesceMs ?? 0;
        const visible = segments.filter((s) => {
          if (s.type === "stay" || s.type === "manual") return true;
          const durMs = new Date(s.end).getTime() - new Date(s.start).getTime();
          return durMs >= minVisibleMs;
        });

        const totalCoords = visible.reduce(
          (sum, s) => sum + (s.path?.length ?? 0),
          0,
        );
        if (totalCoords > input.maxPoints) {
          const scale = input.maxPoints / totalCoords;
          for (const s of visible) {
            if (s.path && s.path.length > 2) {
              s.path = decimatePath(
                s.path,
                Math.max(2, Math.floor(s.path.length * scale)),
              );
            }
          }
        }
        return { segments: visible, rangeMs, totalSegments: segments.length };
      }

      case "at": {
        const time = input.time;
        const segments: any[] = await mongo({
          action: "find",
          collection: SEGMENTS,
          query: { start: { $lte: time }, end: { $gte: time } },
          options: { sort: { start: 1 } },
        });
        const priority = { manual: 0, stay: 1, move: 2, gap: 3 } as const;
        segments.sort((a, b) =>
          (priority[a.type as keyof typeof priority] ?? 9) -
          (priority[b.type as keyof typeof priority] ?? 9)
        );
        const segment = segments[0] ?? null;

        const [before] = await mongo({
          action: "find",
          collection: POINTS,
          query: { ts: { $lte: time } },
          options: { sort: { ts: -1 }, limit: 1 },
        });
        const [after] = await mongo({
          action: "find",
          collection: POINTS,
          query: { ts: { $gt: time } },
          options: { sort: { ts: 1 }, limit: 1 },
        });
        const candidates = [before, after].filter(Boolean).filter((p) =>
          Math.abs(new Date(p.ts).getTime() - time.getTime()) <
            30 * 60 * 1000
        );
        candidates.sort((a, b) =>
          Math.abs(new Date(a.ts).getTime() - time.getTime()) -
          Math.abs(new Date(b.ts).getTime() - time.getTime())
        );
        const point = candidates[0] ?? null;

        return {
          segment,
          point,
          place: segment?.place ?? null,
          timeZone: segment?.timeZone ?? null,
        };
      }

      case "for-range": {
        const segments: any[] = await mongo({
          action: "find",
          collection: SEGMENTS,
          query: { start: { $lt: input.end }, end: { $gt: input.start } },
          options: { sort: { start: 1 } },
        });
        const rangeMs = Math.max(
          1,
          input.end.getTime() - input.start.getTime(),
        );

        const stays = segments
          .filter((s) => (s.type === "stay" || s.type === "manual") && s.loc)
          .map((s) => ({
            ...s,
            overlapMs: overlapMs(
              new Date(s.start),
              new Date(s.end),
              input.start,
              input.end,
            ),
          }))
          .sort((a, b) => b.overlapMs - a.overlapMs);

        const knownMs = segments
          .filter((s) => s.type !== "gap")
          .reduce(
            (sum, s) =>
              sum +
              overlapMs(new Date(s.start), new Date(s.end), input.start, input.end),
            0,
          );

        return {
          stays,
          primaryPlace: stays.find((s) => s.place)?.place ?? null,
          primaryStay: stays[0] ?? null,
          coveragePct: Math.min(100, Math.round((knownMs / rangeMs) * 100)),
        };
      }

      case "search-places": {
        const escaped = input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = `^${escaped}`;
        return await mongo({
          action: "find",
          collection: GEONAMES,
          query: {
            $or: [
              { asciiName: { $regex: pattern, $options: "i" } },
              { name: { $regex: pattern, $options: "i" } },
            ],
          },
          options: {
            sort: { population: -1 },
            limit: input.limit,
            projection: {
              geonameId: 1,
              name: 1,
              asciiName: 1,
              country: 1,
              countryCode: 1,
              admin1: 1,
              population: 1,
              loc: 1,
              tz: 1,
            },
          },
        });
      }

      case "assign-manual": {
        let lat: number;
        let lng: number;
        let placeName: string | undefined = input.place.name;
        let country: string | undefined;
        let countryCode: string | undefined;
        const geonameId: number | undefined = input.place.geonameId;
        let cityTz: string | undefined;

        if (geonameId !== undefined) {
          const city = await mongo({
            action: "findOne",
            collection: GEONAMES,
            query: { geonameId },
          });
          if (!city) throw new Error(`Unknown geonameId: ${geonameId}`);
          lat = city.loc.coordinates[1];
          lng = city.loc.coordinates[0];
          placeName = placeName ?? city.name;
          country = city.country;
          countryCode = city.countryCode;
          cityTz = city.tz;
        } else {
          lat = input.place.latitude!;
          lng = input.place.longitude!;
        }

        let timeZone = input.timeZone ?? cityTz;
        if (!timeZone) {
          try {
            timeZone = tzLookup(lat, lng);
          } catch {
            timeZone = undefined;
          }
        }

        const now = new Date();
        const segmentDoc = {
          type: "manual",
          start: input.start,
          end: input.end,
          loc: { type: "Point", coordinates: [lng, lat] },
          place: {
            name: placeName ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            ...(placeName ? { city: placeName } : {}),
            ...(country ? { country } : {}),
            ...(countryCode ? { countryCode } : {}),
            ...(geonameId !== undefined ? { geonameId } : {}),
          },
          ...(timeZone ? { timeZone } : {}),
          source: "manual",
          createdAt: now,
          updatedAt: now,
          createdBy: auth.principal,
        };
        const inserted = await mongo({
          action: "insertOne",
          collection: SEGMENTS,
          doc: segmentDoc,
        });

        if (timeZone) {
          // Replace only periods this feature created earlier for overlapping
          // ranges; hand-created manual periods are left untouched.
          await mongo({
            action: "deleteMany",
            collection: TZ_PERIODS,
            query: {
              "metadata.origin": "location-manual",
              start: { $lt: input.end },
              end: { $gt: input.start },
            },
          });
          await mongo({
            action: "insertOne",
            collection: TZ_PERIODS,
            doc: {
              start: input.start,
              end: input.end,
              timeZone,
              location: { name: placeName, latitude: lat, longitude: lng },
              source: "manual",
              metadata: { origin: "location-manual" },
              createdAt: now,
              updatedAt: now,
              createdBy: auth.principal,
            },
          });
        }

        await this.enqueueReprocess(
          auth,
          input.start,
          input.end,
          "Manual location assigned; re-clipping derived segments",
        );

        return { ...segmentDoc, _id: inserted.insertedId };
      }

      case "delete-segment": {
        const segment = await mongo({
          action: "findOne",
          collection: SEGMENTS,
          query: { _id: new ObjectId(input.id) },
        });
        if (!segment) return { success: false, error: "Segment not found" };
        if (segment.type !== "manual") {
          throw new Error("Only manual segments can be deleted");
        }
        await mongo({
          action: "deleteOne",
          collection: SEGMENTS,
          query: { _id: new ObjectId(input.id) },
        });
        await mongo({
          action: "deleteMany",
          collection: TZ_PERIODS,
          query: {
            "metadata.origin": "location-manual",
            start: segment.start,
            end: segment.end,
          },
        });
        await this.enqueueReprocess(
          auth,
          new Date(segment.start),
          new Date(segment.end),
          "Manual location removed; regenerating derived segments",
        );
        return { success: true };
      }

      case "conversations-on-map": {
        const rangeQuery: Record<string, unknown> = {
          type: { $in: ["stay", "manual"] },
          loc: { $exists: true },
        };
        if (input.start && input.end) {
          rangeQuery.start = { $lt: input.end };
          rangeQuery.end = { $gt: input.start };
        }
        const stays: any[] = await mongo({
          action: "find",
          collection: SEGMENTS,
          query: rangeQuery,
          options: { sort: { start: 1 } },
        });
        if (stays.length === 0) {
          return { groups: [], unmatched: 0, conversationCount: 0 };
        }

        // Query conversations per merged stay window instead of "newest N
        // overall": with tens of thousands of conversations a global limit
        // silently drops everything that overlaps older stays.
        const SLACK_MS = 6 * 60 * 60 * 1000; // long conversation may start before the stay
        const staysForWindows = stays.slice(0, 500);
        const windows: Array<{ start: Date; end: Date }> = [];
        for (const stay of staysForWindows) {
          const start = new Date(new Date(stay.start).getTime() - SLACK_MS);
          const end = new Date(stay.end);
          const last = windows[windows.length - 1];
          if (last && start.getTime() <= last.end.getTime()) {
            if (end.getTime() > last.end.getTime()) last.end = end;
          } else {
            windows.push({ start, end });
          }
        }

        const conversations: any[] = [];
        for (const window of windows) {
          const batch = await mongo({
            action: "find",
            collection: "objects",
            query: {
              isConversation: true,
              "timeRanges.0.start": { $gte: window.start, $lt: window.end },
            },
            options: {
              sort: { "timeRanges.0.start": -1 },
              limit: 1000,
              projection: { name: 1, icon: 1, timeRanges: 1 },
            },
          });
          conversations.push(...batch);
        }

        const groups = new Map<string, {
          key: string;
          loc: any;
          place: any;
          stayCount: number;
          conversations: any[];
        }>();
        let matched = 0;

        for (const conv of conversations) {
          const range = conv.timeRanges?.[0];
          if (!range?.start) continue;
          const convStart = new Date(range.start).getTime();
          const convEnd = range.end
            ? new Date(range.end).getTime()
            : convStart;
          if (input.start && convEnd < input.start.getTime()) continue;
          const mid = (convStart + convEnd) / 2;

          const stay = stays.find((s) =>
            new Date(s.start).getTime() <= mid &&
            new Date(s.end).getTime() >= mid
          );
          if (!stay) continue;
          matched++;

          const key = stay.place?.geonameId
            ? `place:${stay.place.geonameId}`
            : `stay:${stay._id}`;
          let group = groups.get(key);
          if (!group) {
            group = {
              key,
              loc: stay.loc,
              place: stay.place ?? null,
              stayCount: 0,
              conversations: [],
            };
            groups.set(key, group);
          }
          if (group.conversations.length < 100) {
            group.conversations.push({
              _id: conv._id,
              name: conv.name,
              icon: conv.icon,
              start: range.start,
              end: range.end ?? null,
              stayId: stay._id,
              stayLoc: stay.loc,
            });
          }
        }

        // Count distinct stays per group
        for (const stay of stays) {
          const key = stay.place?.geonameId
            ? `place:${stay.place.geonameId}`
            : `stay:${stay._id}`;
          const group = groups.get(key);
          if (group) group.stayCount++;
        }

        return {
          groups: [...groups.values()].map((g) => ({
            ...g,
            conversationCount: g.conversations.length,
          })).sort((a, b) => b.conversationCount - a.conversationCount),
          unmatched: conversations.length - matched,
          conversationCount: matched,
        };
      }

      case "status": {
        const [pointCount, segmentCount, geonamesCount, lastImport] =
          await Promise.all([
            mongo({ action: "count", collection: POINTS, query: {} }),
            mongo({ action: "count", collection: SEGMENTS, query: {} }),
            mongo({ action: "count", collection: GEONAMES, query: {} }),
            mongo({
              action: "find",
              collection: IMPORTS,
              query: {},
              options: { sort: { createdAt: -1 }, limit: 1 },
            }).then((docs: any[]) => docs[0] ?? null),
          ]);
        return {
          hasData: pointCount > 0 || segmentCount > 0,
          pointCount,
          segmentCount,
          geonamesReady: geonamesCount > 0,
          geonamesCount,
          lastImportAt: lastImport?.createdAt ?? null,
        };
      }

      case "list-imports": {
        return await mongo({
          action: "find",
          collection: IMPORTS,
          query: {},
          options: { sort: { createdAt: -1 }, limit: 100 },
        });
      }

      case "delete-import": {
        const importId = new ObjectId(input.id);
        const importDoc = await mongo({
          action: "findOne",
          collection: IMPORTS,
          query: { _id: importId },
        });
        if (!importDoc) return { success: false, error: "Import not found" };

        const deleted = await mongo({
          action: "deleteMany",
          collection: POINTS,
          query: { importId },
        });
        await mongo({
          action: "deleteOne",
          collection: IMPORTS,
          query: { _id: importId },
        });
        if (importDoc.timeRange?.start && importDoc.timeRange?.end) {
          await this.enqueueReprocess(
            auth,
            new Date(importDoc.timeRange.start),
            new Date(importDoc.timeRange.end),
            "Import deleted; regenerating derived segments",
          );
        }
        return { success: true, deletedPoints: deleted.deletedCount ?? 0 };
      }
    }
  }

  private async enqueueReprocess(
    auth: Auth,
    start: Date,
    end: Date,
    reason: string,
  ): Promise<void> {
    try {
      const jobs = await getJobsResource(auth);
      await jobs({
        action: "enqueue",
        data: {
          type: "location_processing",
          start: new Date(start.getTime() - REPROCESS_PAD_MS).toISOString(),
          end: new Date(end.getTime() + REPROCESS_PAD_MS).toISOString(),
        },
        trigger: { type: "manual", reason },
      });
    } catch (err) {
      console.warn(
        "[location] Failed to enqueue location_processing:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
