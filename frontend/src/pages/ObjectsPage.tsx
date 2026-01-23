import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { Object } from "@/types/objects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeftRight,
  ArrowRight,
  Calendar,
  CalendarClock,
  Clock,
  Handshake,
  Package,
  Plus,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function escapeRegex(source: string) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(text: string, query: string) {
  const words = query
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return text;
  const pattern = `(${words.map(escapeRegex).join("|")})`;
  const splitRe = new RegExp(pattern, "gi");
  const checkRe = new RegExp(pattern, "i");
  const parts = text.split(splitRe);
  return (
    <>
      {parts.map((part, idx) =>
        checkRe.test(part)
          ? (
            <mark key={idx} className="bg-yellow-200">
              {part}
            </mark>
          )
          : <span key={idx}>{part}</span>
      )}
    </>
  );
}

function renderIcon(icon: any) {
  if (!icon) return "";
  if (typeof icon === "string") return icon;
  if (icon.text) return icon.text;
  if (icon.base64) return "📷";
  return "";
}

function formatDate(date: Date | string | undefined) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getObjectType(
  object: Object,
): "person" | "event" | "relationship" | "promise" | "other" {
  if (object.isPromise) return "promise";
  if (object.isRelationship) return "relationship";
  if (object.isPerson) return "person";
  if (object.isEvent) return "event";
  return "other";
}

const TYPE_CONFIG = {
  person: {
    label: "People",
    icon: User,
    color: "bg-blue-100 text-blue-800 border-blue-200",
    badgeVariant: "secondary" as const,
  },
  event: {
    label: "Events",
    icon: Calendar,
    color: "bg-green-100 text-green-800 border-green-200",
    badgeVariant: "secondary" as const,
  },
  relationship: {
    label: "Relationships",
    icon: Users,
    color: "bg-purple-100 text-purple-800 border-purple-200",
    badgeVariant: "secondary" as const,
  },
  promise: {
    label: "Promises",
    icon: Handshake,
    color: "bg-orange-100 text-orange-800 border-orange-200",
    badgeVariant: "secondary" as const,
  },
  other: {
    label: "Other",
    icon: Package,
    color: "bg-gray-100 text-gray-800 border-gray-200",
    badgeVariant: "secondary" as const,
  },
};

interface ObjectCardProps {
  object: Object & { subjectObject?: Object; objectObject?: Object };
  searchQuery: string;
  showType?: boolean;
}

function ObjectCard({ object, searchQuery, showType = false }: ObjectCardProps) {
  const isRelationship = object.isRelationship;
  const hasRelationshipData = object.relationship && object.subjectObject &&
    object.objectObject;
  const objectType = getObjectType(object);
  const typeConfig = TYPE_CONFIG[objectType];

  const timeRangeInfo = useMemo(() => {
    if (!object.timeRanges || object.timeRanges.length === 0) return null;
    const first = object.timeRanges[0];
    const hasEnd = !!first.end;
    return {
      start: formatDate(first.start),
      end: hasEnd ? formatDate(first.end) : null,
      count: object.timeRanges.length,
    };
  }, [object.timeRanges]);

  return (
    <Link to={`/objects/${object._id.toString()}`}>
      <Card className="p-4 hover:border-primary transition-colors h-full">
        <div className="space-y-3">
          {/* Header with icon, name and type badge */}
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="text-xl flex-shrink-0 w-8 h-8 flex items-center justify-center rounded"
              style={{ backgroundColor: object.color ? `${object.color}20` : undefined }}
            >
              {renderIcon(object.icon)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {searchQuery.trim() && object.name
                    ? renderHighlightedText(object.name, searchQuery.trim())
                    : object.name || "Unnamed"}
                </span>
                {showType && (
                  <Badge variant="outline" className={`text-xs ${typeConfig.color}`}>
                    {objectType === "other" ? "Object" : objectType}
                  </Badge>
                )}
              </div>
              {object.aliases && object.aliases.length > 0 && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  aka {object.aliases.slice(0, 2).join(", ")}
                  {object.aliases.length > 2 && ` +${object.aliases.length - 2}`}
                </div>
              )}
            </div>
          </div>

          {/* Relationship info */}
          {isRelationship && hasRelationshipData && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pl-11">
              <div className="flex items-center gap-1 min-w-0">
                <span className="flex-shrink-0">{renderIcon(object.subjectObject?.icon)}</span>
                <span className="truncate">{object.subjectObject?.name}</span>
              </div>
              {object.relationship?.symmetrical
                ? <ArrowLeftRight className="w-4 h-4 flex-shrink-0" />
                : <ArrowRight className="w-4 h-4 flex-shrink-0" />}
              <div className="flex items-center gap-1 min-w-0">
                <span className="flex-shrink-0">{renderIcon(object.objectObject?.icon)}</span>
                <span className="truncate">{object.objectObject?.name}</span>
              </div>
            </div>
          )}

          {/* Details */}
          {object.details && (
            <div className="text-sm text-muted-foreground line-clamp-2 pl-11">
              {object.details}
            </div>
          )}

          {/* Time range and metadata */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground pl-11 flex-wrap">
            {timeRangeInfo && (
              <div className="flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                <span>
                  {timeRangeInfo.start}
                  {timeRangeInfo.end ? ` - ${timeRangeInfo.end}` : " - ongoing"}
                </span>
                {timeRangeInfo.count > 1 && (
                  <span className="text-muted-foreground/60">
                    (+{timeRangeInfo.count - 1} more)
                  </span>
                )}
              </div>
            )}
            {object.updatedAt && (
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>Updated {formatDate(object.updatedAt)}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

type ObjectType = "person" | "event" | "relationship" | "promise" | "other";
type SortOption = "name" | "updatedAt" | "createdAt";

interface TypeFilterButtonProps {
  type: ObjectType;
  count: number;
  isActive: boolean;
  onClick: () => void;
}

function TypeFilterButton({ type, count, isActive, onClick }: TypeFilterButtonProps) {
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg border transition-all
        ${isActive
          ? `${config.color} border-current`
          : "bg-background border-border hover:bg-muted"
        }
      `}
    >
      <Icon className="w-4 h-4" />
      <span className="text-sm font-medium">{config.label}</span>
      <Badge variant="secondary" className="text-xs ml-1">
        {count}
      </Badge>
    </button>
  );
}

const ObjectsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [objects, setObjects] = useState<
    (Object & { subjectObject?: Object; objectObject?: Object })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Total counts per type from database (independent of current filter)
  const [totalCounts, setTotalCounts] = useState<Record<ObjectType, number>>({
    person: 0,
    event: 0,
    relationship: 0,
    promise: 0,
    other: 0,
  });
  const [countsLoading, setCountsLoading] = useState(true);

  const q = searchParams.get("q") || "";
  const sortBy = (searchParams.get("sort") as SortOption) || "updatedAt";
  // Get active type filters from URL (comma-separated)
  const activeTypesParam = searchParams.get("types") || "";
  const activeTypes = useMemo(() => {
    if (!activeTypesParam) return new Set<ObjectType>();
    return new Set(activeTypesParam.split(",").filter(Boolean) as ObjectType[]);
  }, [activeTypesParam]);

  const [localQ, setLocalQ] = useState(q);

  // Fetch total counts per type (only depends on search query, not type filters)
  useEffect(() => {
    const fetchCounts = async () => {
      setCountsLoading(true);
      try {
        const searchMatch: Record<string, unknown> = {};
        if (q.trim()) {
          searchMatch.$text = { $search: q.trim() };
        }

        const pipeline = [
          { $match: searchMatch },
          {
            $group: {
              _id: null,
              person: { $sum: { $cond: [{ $eq: ["$isPerson", true] }, 1, 0] } },
              event: { $sum: { $cond: [{ $eq: ["$isEvent", true] }, 1, 0] } },
              promise: { $sum: { $cond: [{ $eq: ["$isPromise", true] }, 1, 0] } },
              relationship: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$isRelationship", true] },
                        { $ne: ["$isPromise", true] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              other: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$isPerson", true] },
                        { $ne: ["$isEvent", true] },
                        { $ne: ["$isRelationship", true] },
                        { $ne: ["$isPromise", true] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              total: { $sum: 1 },
            },
          },
        ];

        const result = await callResource("mongo", {
          action: "aggregate",
          collection: "objects",
          pipeline,
        });

        if (result && result.length > 0) {
          const counts = result[0];
          setTotalCounts({
            person: counts.person || 0,
            event: counts.event || 0,
            relationship: counts.relationship || 0,
            promise: counts.promise || 0,
            other: counts.other || 0,
          });
        } else {
          setTotalCounts({
            person: 0,
            event: 0,
            relationship: 0,
            promise: 0,
            other: 0,
          });
        }
      } catch (err) {
        console.error("Failed to fetch counts:", err);
      } finally {
        setCountsLoading(false);
      }
    };

    fetchCounts();
  }, [q]);

  function updateFilters(
    newQ: string,
    newTypes: Set<ObjectType>,
    newSort: SortOption,
  ) {
    const newSearchParams = new URLSearchParams();

    if (newQ.trim()) {
      newSearchParams.set("q", newQ.trim());
    }

    if (newTypes.size > 0) {
      newSearchParams.set("types", Array.from(newTypes).join(","));
    }

    if (newSort !== "updatedAt") {
      newSearchParams.set("sort", newSort);
    }

    setSearchParams(newSearchParams);
  }

  function toggleType(type: ObjectType) {
    const newTypes = new Set(activeTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    updateFilters(q, newTypes, sortBy);
  }

  function clearAllFilters() {
    setLocalQ("");
    setSearchParams(new URLSearchParams());
  }

  useEffect(() => {
    const buildQuery = () => {
      const query: Record<string, unknown> = {};

      // Build OR query for types if any are selected
      if (activeTypes.size > 0) {
        const typeConditions: Record<string, unknown>[] = [];
        
        if (activeTypes.has("person")) {
          typeConditions.push({ isPerson: true });
        }
        if (activeTypes.has("event")) {
          typeConditions.push({ isEvent: true });
        }
        if (activeTypes.has("relationship")) {
          // Relationships but NOT promises
          typeConditions.push({ isRelationship: true, isPromise: { $ne: true } });
        }
        if (activeTypes.has("promise")) {
          typeConditions.push({ isPromise: true });
        }
        if (activeTypes.has("other")) {
          typeConditions.push({
            isPerson: { $ne: true },
            isEvent: { $ne: true },
            isRelationship: { $ne: true },
            isPromise: { $ne: true },
          });
        }

        if (typeConditions.length > 0) {
          query.$or = typeConditions;
        }
      }

      const searchQuery = q.trim();
      if (searchQuery) {
        query.$text = { $search: searchQuery };
      }

      return query;
    };

    const getSortStage = () => {
      if (q.trim()) {
        return { $sort: { score: { $meta: "textScore" }, _id: -1 } };
      }
      switch (sortBy) {
        case "name":
          return { $sort: { name: 1, _id: -1 } };
        case "createdAt":
          return { $sort: { createdAt: -1, _id: -1 } };
        case "updatedAt":
        default:
          return { $sort: { updatedAt: -1, _id: -1 } };
      }
    };

    const fetchObjects = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = buildQuery();
        const pipeline: unknown[] = [
          { $match: query },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.subject",
              foreignField: "_id",
              as: "subjectObject",
            },
          },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.object",
              foreignField: "_id",
              as: "objectObject",
            },
          },
          {
            $unwind: {
              path: "$subjectObject",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $unwind: {
              path: "$objectObject",
              preserveNullAndEmptyArrays: true,
            },
          },
          getSortStage(),
          { $limit: 100 },
        ];

        const result = await callResource("mongo", {
          action: "aggregate",
          collection: "objects",
          pipeline,
        });
        setObjects(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch objects",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchObjects();
  }, [q, activeTypesParam, sortBy]);

  useEffect(() => {
    setLocalQ(q);
  }, [q]);

  // Count objects in current results (for showing "X loaded")
  const loadedCounts = useMemo(() => {
    const counts: Record<ObjectType, number> = {
      person: 0,
      event: 0,
      relationship: 0,
      promise: 0,
      other: 0,
    };
    for (const obj of objects) {
      counts[getObjectType(obj)]++;
    }
    return counts;
  }, [objects]);

  // Total count across all types
  const grandTotal = useMemo(() => {
    return Object.values(totalCounts).reduce((sum, c) => sum + c, 0);
  }, [totalCounts]);

  // Group objects by type for display
  const groupedObjects = useMemo(() => {
    const groups: Record<ObjectType, typeof objects> = {
      person: [],
      event: [],
      relationship: [],
      promise: [],
      other: [],
    };
    for (const obj of objects) {
      groups[getObjectType(obj)].push(obj);
    }
    return groups;
  }, [objects]);

  // Determine which types to show based on filters
  const visibleTypes = useMemo(() => {
    if (activeTypes.size === 0) {
      // Show all non-empty types
      return (Object.keys(TYPE_CONFIG) as ObjectType[]).filter(
        (type) => groupedObjects[type].length > 0
      );
    }
    // Show only selected types that have results
    return Array.from(activeTypes).filter(
      (type) => groupedObjects[type].length > 0
    );
  }, [activeTypes, groupedObjects]);

  const hasActiveFilters = q.trim() || activeTypes.size > 0;
  const totalResults = objects.length;

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Objects</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Objects</h1>
        <Button asChild>
          <Link to="/objects/create">
            <Plus className="w-4 h-4 mr-2" />
            Create Object
          </Link>
        </Button>
      </div>

      {/* Search bar */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          updateFilters(localQ, activeTypes, sortBy);
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            placeholder="Search by name, aliases, or details..."
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={loading}>
          Search
        </Button>
      </form>

      {/* Type filters and sort */}
      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm text-muted-foreground">Filter by type:</Label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYPE_CONFIG) as ObjectType[]).map((type) => (
            <TypeFilterButton
              key={type}
              type={type}
              count={totalCounts[type]}
              isActive={activeTypes.has(type)}
              onClick={() => toggleType(type)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-sm text-muted-foreground">Sort:</Label>
          <Select
            value={sortBy}
            onValueChange={(value: SortOption) =>
              updateFilters(q, activeTypes, value)
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updatedAt">Recently Updated</SelectItem>
              <SelectItem value="createdAt">Recently Created</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results summary */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {loading
            ? "Loading..."
            : countsLoading
              ? "Counting..."
              : hasActiveFilters
                ? `Showing ${totalResults} of ${activeTypes.size > 0
                    ? Array.from(activeTypes).reduce((sum, t) => sum + totalCounts[t], 0)
                    : grandTotal
                  } matching objects`
                : `${grandTotal} objects total`}
          {!loading && totalResults === 100 && " (limit reached)"}
        </span>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-7 text-xs"
          >
            <X className="w-3 h-3 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading objects...</p>
        </div>
      )}

      {/* Results */}
      {!loading && objects.length === 0 && (
        <Card className="p-8 text-center">
          <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            {hasActiveFilters
              ? "No objects found matching your filters."
              : "No objects found. Objects are created through the application."}
          </p>
          {hasActiveFilters && (
            <Button
              variant="link"
              onClick={clearAllFilters}
              className="mt-2"
            >
              Clear all filters
            </Button>
          )}
        </Card>
      )}

      {!loading && objects.length > 0 && (
        <div className="space-y-8">
          {visibleTypes.map((type) => {
            const typeObjects = groupedObjects[type];
            if (typeObjects.length === 0) return null;

            const config = TYPE_CONFIG[type];
            const Icon = config.icon;

            const total = totalCounts[type];
            const loaded = typeObjects.length;
            const hasMore = loaded < total;
            const isFiltered = activeTypes.size > 0;

            return (
              <section key={type}>
                <div className="flex items-center gap-2 mb-4">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">{config.label}</h2>
                  <Badge variant="secondary">
                    {hasMore ? `${loaded} of ${total}` : total}
                  </Badge>
                  {hasMore && !isFiltered && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={() => toggleType(type)}
                    >
                      Show all
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {typeObjects.map((object) => (
                    <ObjectCard
                      key={object._id.toString()}
                      object={object}
                      searchQuery={q}
                      showType={false}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {objects.length === 100 && grandTotal > 100 && (
            <div className="text-sm text-muted-foreground text-center py-4 border-t pt-4">
              Showing first 100 of {grandTotal} objects. Use search or type filters to narrow down results.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ObjectsPage;
