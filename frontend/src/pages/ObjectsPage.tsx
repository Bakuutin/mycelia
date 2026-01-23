import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { Object as ObjectModel } from "@/types/objects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeftRight,
  ArrowRight,
  Calendar,
  CalendarClock,
  ChevronDown,
  ChevronRight,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  object: ObjectModel,
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
  object: ObjectModel & { subjectObject?: ObjectModel; objectObject?: ObjectModel };
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

type ObjectWithRelations = ObjectModel & { subjectObject?: ObjectModel; objectObject?: ObjectModel };

const ITEMS_PER_TYPE = 25; // Initial items per type
const LOAD_MORE_COUNT = 50; // Items to load when clicking "load more"
const MAX_ITEMS_PER_TYPE = 500; // Maximum items per type for "load all"

const ObjectsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Objects grouped by type
  const [objectsByType, setObjectsByType] = useState<Record<ObjectType, ObjectWithRelations[]>>({
    person: [],
    event: [],
    relationship: [],
    promise: [],
    other: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadingTypes, setLoadingTypes] = useState<Set<ObjectType>>(new Set());
  const [error, setError] = useState<string | null>(null);
  
  // How many items to show per type
  const [limits, setLimits] = useState<Record<ObjectType, number>>({
    person: ITEMS_PER_TYPE,
    event: ITEMS_PER_TYPE,
    relationship: ITEMS_PER_TYPE,
    promise: ITEMS_PER_TYPE,
    other: ITEMS_PER_TYPE,
  });
  
  // Collapsed state per type
  const [collapsed, setCollapsed] = useState<Record<ObjectType, boolean>>({
    person: false,
    event: false,
    relationship: false,
    promise: false,
    other: false,
  });
  
  // Total counts per type from database
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

  // Get sort stage based on current sort option
  const getSortStage = useCallback(() => {
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
  }, [q, sortBy]);

  // Get type match condition
  const getTypeMatch = useCallback((type: ObjectType): Record<string, unknown> => {
    switch (type) {
      case "person":
        return { isPerson: true };
      case "event":
        return { isEvent: true };
      case "relationship":
        return { isRelationship: true, isPromise: { $ne: true } };
      case "promise":
        return { isPromise: true };
      case "other":
        return {
          isPerson: { $ne: true },
          isEvent: { $ne: true },
          isRelationship: { $ne: true },
          isPromise: { $ne: true },
        };
    }
  }, []);

  // Fetch objects for a specific type
  const fetchTypeObjects = useCallback(async (type: ObjectType, limit: number): Promise<ObjectWithRelations[]> => {
    const typeMatch = getTypeMatch(type);
    const searchMatch: Record<string, unknown> = { ...typeMatch };
    
    if (q.trim()) {
      searchMatch.$text = { $search: q.trim() };
    }

    const pipeline: unknown[] = [
      { $match: searchMatch },
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
      { $limit: limit },
    ];

    return await callResource("mongo", {
      action: "aggregate",
      collection: "objects",
      pipeline,
    });
  }, [q, getSortStage, getTypeMatch]);

  // Fetch total counts per type
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

  // Fetch all types in parallel
  useEffect(() => {
    const fetchAllTypes = async () => {
      setLoading(true);
      setError(null);
      
      // Reset limits when search/sort changes
      setLimits({
        person: ITEMS_PER_TYPE,
        event: ITEMS_PER_TYPE,
        relationship: ITEMS_PER_TYPE,
        promise: ITEMS_PER_TYPE,
        other: ITEMS_PER_TYPE,
      });
      
      try {
        const typesToFetch = activeTypes.size > 0 
          ? Array.from(activeTypes) 
          : (Object.keys(TYPE_CONFIG) as ObjectType[]);
        
        const results = await Promise.all(
          typesToFetch.map(async (type) => ({
            type,
            objects: await fetchTypeObjects(type, ITEMS_PER_TYPE),
          }))
        );
        
        const newObjectsByType: Record<ObjectType, ObjectWithRelations[]> = {
          person: [],
          event: [],
          relationship: [],
          promise: [],
          other: [],
        };
        
        for (const { type, objects } of results) {
          newObjectsByType[type] = objects;
        }
        
        setObjectsByType(newObjectsByType);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch objects");
      } finally {
        setLoading(false);
      }
    };

    fetchAllTypes();
  }, [q, sortBy, activeTypesParam, fetchTypeObjects]);

  // Load more for a specific type
  const loadMore = useCallback(async (type: ObjectType, loadAll = false) => {
    const total = totalCounts[type];
    const newLimit = loadAll 
      ? Math.min(total, MAX_ITEMS_PER_TYPE) 
      : Math.min(limits[type] + LOAD_MORE_COUNT, total);
    
    setLoadingTypes((prev) => new Set(prev).add(type));
    
    try {
      const objects = await fetchTypeObjects(type, newLimit);
      setObjectsByType((prev) => ({ ...prev, [type]: objects }));
      setLimits((prev) => ({ ...prev, [type]: newLimit }));
    } catch (err) {
      console.error(`Failed to load more ${type}:`, err);
    } finally {
      setLoadingTypes((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  }, [limits, totalCounts, fetchTypeObjects]);

  useEffect(() => {
    setLocalQ(q);
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

  function toggleCollapsed(type: ObjectType) {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  function clearAllFilters() {
    setLocalQ("");
    setSearchParams(new URLSearchParams());
  }

  // Total count across all types
  const grandTotal = useMemo(() => {
    return Object.values(totalCounts).reduce((sum, c) => sum + c, 0);
  }, [totalCounts]);

  // Determine which types to show based on filters
  const visibleTypes = useMemo(() => {
    if (activeTypes.size === 0) {
      // Show all types that have items (in database)
      return (Object.keys(TYPE_CONFIG) as ObjectType[]).filter(
        (type) => totalCounts[type] > 0
      );
    }
    // Show only selected types that have results
    return Array.from(activeTypes).filter(
      (type) => totalCounts[type] > 0
    );
  }, [activeTypes, totalCounts]);

  const hasActiveFilters = q.trim() || activeTypes.size > 0;

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
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="text-muted-foreground">
          {loading
            ? "Loading..."
            : countsLoading
              ? "Counting..."
              : hasActiveFilters
                ? `${activeTypes.size > 0
                    ? Array.from(activeTypes).reduce((sum, t) => sum + totalCounts[t], 0)
                    : grandTotal
                  } objects found`
                : `${grandTotal} objects in database`}
        </span>
        <span className="text-xs text-muted-foreground/60">
          (expand sections and use "Load more" to see all)
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
      {!loading && grandTotal === 0 && (
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

      {!loading && grandTotal > 0 && (
        <div className="space-y-4">
          {visibleTypes.map((type) => {
            const typeObjects = objectsByType[type];
            const config = TYPE_CONFIG[type];
            const Icon = config.icon;
            const total = totalCounts[type];
            const loaded = typeObjects.length;
            const hasMore = loaded < total;
            const isCollapsed = collapsed[type];
            const isLoadingMore = loadingTypes.has(type);

            return (
              <Collapsible
                key={type}
                open={!isCollapsed}
                onOpenChange={() => toggleCollapsed(type)}
              >
                <div className="border rounded-lg">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-2 w-full p-4 hover:bg-muted/50 transition-colors text-left">
                      {isCollapsed ? (
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                      <Icon className="w-5 h-5 text-muted-foreground" />
                      <h2 className="text-lg font-semibold flex-1">{config.label}</h2>
                      <Badge variant="secondary">
                        {loaded < total ? `${loaded} of ${total}` : total}
                      </Badge>
                    </button>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <div className="p-4 pt-0">
                      {typeObjects.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          Loading...
                        </p>
                      ) : (
                        <>
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
                          
                          {hasMore && (
                            <div className="mt-4 flex items-center justify-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => loadMore(type, false)}
                                disabled={isLoadingMore}
                              >
                                {isLoadingMore
                                  ? "Loading..."
                                  : `Load ${Math.min(LOAD_MORE_COUNT, total - loaded)} more`}
                              </Button>
                              {total - loaded > LOAD_MORE_COUNT && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => loadMore(type, true)}
                                  disabled={isLoadingMore}
                                >
                                  {total <= MAX_ITEMS_PER_TYPE 
                                    ? `Load all ${total - loaded}`
                                    : `Load ${MAX_ITEMS_PER_TYPE - loaded} (max)`}
                                </Button>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {total - loaded} remaining
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ObjectsPage;
