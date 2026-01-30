import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
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
  Link2,
  Link2Off,
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  Search,
  SortAsc,
  SortDesc,
  Star,
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
import { Markdown } from "@/components/Markdown";

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

function formatDateTime(date: Date | string | undefined) {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(startDate: Date | string, endDate?: Date | string | null): string {
  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  const end = endDate
    ? (typeof endDate === "string" ? new Date(endDate) : endDate)
    : new Date();

  const diffMs = end.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "< 1 min";
  if (diffMins < 60) return `${diffMins} min`;
  if (diffHours < 24) {
    const mins = diffMins % 60;
    return mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours}h`;
  }
  if (diffDays < 7) {
    const hours = diffHours % 24;
    return hours > 0 ? `${diffDays}d ${hours}h` : `${diffDays}d`;
  }
  return `${diffDays} days`;
}

function getObjectType(
  object: ObjectModel,
): "person" | "event" | "relationship" | "promise" | "conversation" | "other" {
  if (object.isPromise) return "promise";
  if (object.isRelationship) return "relationship";
  if (object.isConversation) return "conversation";
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
  conversation: {
    label: "Conversations",
    icon: MessageSquare,
    color: "bg-cyan-100 text-cyan-800 border-cyan-200",
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
  object: ObjectModel & {
    subjectObject?: ObjectModel;
    objectObject?: ObjectModel;
    referencesToCount?: number;
    referencesFromCount?: number;
  };
  searchQuery: string;
  showType?: boolean;
  onToggleStar?: (objectId: string, currentStarred: boolean) => void;
}

function ObjectCard({ object, searchQuery, showType = false, onToggleStar }: ObjectCardProps) {
  const isRelationship = object.isRelationship;
  const isConversation = object.isConversation;
  const hasRelationshipData = object.relationship && object.subjectObject &&
    object.objectObject;
  const objectType = getObjectType(object);
  const typeConfig = TYPE_CONFIG[objectType];

  // Reference counts (not shown for relationship objects)
  const referencesToCount = object.referencesToCount ?? 0;
  const referencesFromCount = object.referencesFromCount ?? 0;
  const hasReferences = referencesToCount > 0 || referencesFromCount > 0;

  const timeRangeInfo = useMemo(() => {
    if (!object.timeRanges || object.timeRanges.length === 0) return null;
    const first = object.timeRanges[0];
    const hasEnd = !!first.end;
    return {
      start: first.start,
      end: first.end,
      startFormatted: formatDate(first.start),
      startDateTime: formatDateTime(first.start),
      endFormatted: hasEnd ? formatDate(first.end) : null,
      duration: formatDuration(first.start, first.end),
      count: object.timeRanges.length,
      hasEnd,
    };
  }, [object.timeRanges]);

  const handleStarClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleStar?.(object._id.toString(), !!object.starred);
  };

  return (
    <Link to={`/objects/${object._id.toString()}`}>
      <Card className="p-3 hover:border-primary transition-colors h-full relative group/card">
        {/* Star button - top right corner */}
        {onToggleStar && (
          <button
            type="button"
            onClick={handleStarClick}
            className={`absolute top-2 right-2 p-1 rounded-md transition-all ${
              object.starred
                ? "text-yellow-500 hover:text-yellow-600"
                : "text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover/card:opacity-100"
            }`}
            title={object.starred ? "Remove from starred" : "Add to starred"}
          >
            <Star className={`w-4 h-4 ${object.starred ? "fill-current" : ""}`} />
          </button>
        )}
        <div className="space-y-2">
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
                {/* Duration badge for conversations */}
                {isConversation && timeRangeInfo && (
                  <Badge variant="secondary" className="text-xs">
                    {timeRangeInfo.duration}
                  </Badge>
                )}
              </div>
              {/* Date/time for conversations */}
              {isConversation && timeRangeInfo && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {timeRangeInfo.startDateTime}
                </div>
              )}
              {object.aliases && object.aliases.length > 0 && !isConversation && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  aka {object.aliases.slice(0, 2).join(", ")}
                  {object.aliases.length > 2 && ` +${object.aliases.length - 2}`}
                </div>
              )}
            </div>
          </div>

          {/* Relationship info */}
          {isRelationship && hasRelationshipData && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pl-10">
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

          {/* Details with markdown support */}
          {object.details && (
            <div className="text-sm text-muted-foreground pl-10 line-clamp-3">
              <Markdown compact className="text-muted-foreground">
                {object.details}
              </Markdown>
            </div>
          )}

          {/* Time range and metadata - show for non-conversations */}
          {!isConversation && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground pl-10 flex-wrap">
              {timeRangeInfo && (
                <div className="flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" />
                  <span>
                    {timeRangeInfo.startFormatted}
                    {timeRangeInfo.endFormatted ? ` - ${timeRangeInfo.endFormatted}` : " - ongoing"}
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
          )}

          {/* Reference counts - not shown for relationships */}
          {!isRelationship && hasReferences && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground pl-10">
              <div className="flex items-center gap-1" title="References TO this object (as target)">
                <ArrowRight className="w-3 h-3" />
                <span>{referencesToCount} to</span>
              </div>
              <div className="flex items-center gap-1" title="References FROM this object (as source)">
                <ArrowLeftRight className="w-3 h-3" />
                <span>{referencesFromCount} from</span>
              </div>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

type ObjectType = "person" | "event" | "relationship" | "promise" | "conversation" | "other";
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

type ObjectWithRelations = ObjectModel & {
  subjectObject?: ObjectModel;
  objectObject?: ObjectModel;
  referencesToCount?: number;
  referencesFromCount?: number;
};

const ITEMS_PER_TYPE = 20; // Initial items per type
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
    conversation: [],
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
    conversation: ITEMS_PER_TYPE,
    other: ITEMS_PER_TYPE,
  });

  // Collapsed state per type
  const [collapsed, setCollapsed] = useState<Record<ObjectType, boolean>>({
    person: false,
    event: false,
    relationship: false,
    promise: false,
    conversation: false,
    other: false,
  });

  // Section-specific sort (for conversations: chronological vs recent)
  type SectionSortOption = "default" | "chronological" | "chronological-desc";
  const [sectionSort, setSectionSort] = useState<Record<ObjectType, SectionSortOption>>({
    person: "default",
    event: "default",
    relationship: "default",
    promise: "default",
    conversation: "chronological-desc", // Default to newest first for conversations
    other: "default",
  });

  // Total counts per type from database
  const [totalCounts, setTotalCounts] = useState<Record<ObjectType, number>>({
    person: 0,
    event: 0,
    relationship: 0,
    promise: 0,
    conversation: 0,
    other: 0,
  });
  const [countsLoading, setCountsLoading] = useState(true);
  const [orphanedCount, setOrphanedCount] = useState<number | null>(null);
  
  // Starred objects section
  const [starredObjects, setStarredObjects] = useState<ObjectWithRelations[]>([]);
  const [starredCollapsed, setStarredCollapsed] = useState(false);

  const q = searchParams.get("q") || "";
  const sortBy = (searchParams.get("sort") as SortOption) || "updatedAt";
  // Get active type filters from URL (comma-separated)
  const activeTypesParam = searchParams.get("types") || "";
  const activeTypes = useMemo(() => {
    if (!activeTypesParam) return new Set<ObjectType>();
    return new Set(activeTypesParam.split(",").filter(Boolean) as ObjectType[]);
  }, [activeTypesParam]);
  // Get orphaned filter from URL
  const showOrphanedOnly = searchParams.get("orphaned") === "true";

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
      case "conversation":
        return { isConversation: true };
      case "other":
        return {
          isPerson: { $ne: true },
          isEvent: { $ne: true },
          isRelationship: { $ne: true },
          isPromise: { $ne: true },
          isConversation: { $ne: true },
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
    ];

    // Only do expensive orphaned checks when the filter is active
    if (showOrphanedOnly) {
      // Relationships cannot be orphaned - they ARE the references between objects
      // Skip fetching for relationship type when orphaned filter is active
      if (type === "relationship") {
        return [];
      }

      // OPTIMIZATION: Sort and limit BEFORE expensive lookups
      // We fetch more than needed (5x) since some will be filtered out as non-orphaned
      // This makes orphaned filter fast while still returning reasonable results
      pipeline.push(getSortStage());
      pipeline.push({ $limit: limit * 5 });

      // Check if this object is referenced as subject in any relationship
      pipeline.push({
        $lookup: {
          from: "objects",
          let: { objectId: "$_id" },
          pipeline: [
            {
              $match: {
                isRelationship: true,
                $expr: { $eq: ["$relationship.subject", "$$objectId"] },
              },
            },
            { $limit: 1 }, // Only need to know if any exist, not all of them
          ],
          as: "referencedAsSubject",
        },
      });
      // Check if this object is referenced as object in any relationship
      pipeline.push({
        $lookup: {
          from: "objects",
          let: { objectId: "$_id" },
          pipeline: [
            {
              $match: {
                isRelationship: true,
                $expr: { $eq: ["$relationship.object", "$$objectId"] },
              },
            },
            { $limit: 1 }, // Only need to know if any exist, not all of them
          ],
          as: "referencedAsObject",
        },
      });
      // Filter for orphaned objects (not referenced anywhere)
      pipeline.push({
        $match: {
          $expr: {
            $and: [
              { $eq: [{ $size: { $ifNull: ["$referencedAsSubject", []] } }, 0] },
              { $eq: [{ $size: { $ifNull: ["$referencedAsObject", []] } }, 0] },
            ],
          },
        },
      });
      // Final limit after orphaned filtering
      pipeline.push({ $limit: limit });
    } else {
      // OPTIMIZATION: Sort and limit BEFORE expensive lookups
      // This way we only do lookups on the limited set of documents
      pipeline.push(getSortStage());
      pipeline.push({ $limit: limit });

      // Now add relationship lookups only on the limited documents
      if (type === "relationship") {
        pipeline.push({
          $lookup: {
            from: "objects",
            localField: "relationship.subject",
            foreignField: "_id",
            as: "subjectObject",
          },
        });
        pipeline.push({
          $lookup: {
            from: "objects",
            localField: "relationship.object",
            foreignField: "_id",
            as: "objectObject",
          },
        });
        pipeline.push({
          $unwind: {
            path: "$subjectObject",
            preserveNullAndEmptyArrays: true,
          },
        });
        pipeline.push({
          $unwind: {
            path: "$objectObject",
            preserveNullAndEmptyArrays: true,
          },
        });
      }
      // Skip reference counts for initial load - they're not critical
      // and cause significant slowdown
    }

    return await callResource("mongo", {
      action: "aggregate",
      collection: "objects",
      pipeline,
    });
  }, [q, getSortStage, getTypeMatch, showOrphanedOnly]);

  // Fetch starred objects
  const fetchStarredObjects = useCallback(async (): Promise<ObjectWithRelations[]> => {
    const searchMatch: Record<string, unknown> = { starred: true };
    
    if (q.trim()) {
      searchMatch.$text = { $search: q.trim() };
    }

    const pipeline: unknown[] = [
      { $match: searchMatch },
      getSortStage(),
      { $limit: 50 }, // Limit starred objects
      // Add relationship lookups for starred relationship objects
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
    ];

    return await callResource("mongo", {
      action: "aggregate",
      collection: "objects",
      pipeline,
    });
  }, [q, getSortStage]);

  // Fetch total counts per type from cached API (no search filter - absolute counts)
  const fetchCounts = useCallback(async (forceRefresh = false) => {
    setCountsLoading(true);
    try {
      const result = await callResource("objects", {
        action: "getCounts",
        forceRefresh,
      });

      if (result) {
        setTotalCounts({
          person: result.person || 0,
          event: result.event || 0,
          relationship: result.relationship || 0,
          promise: result.promise || 0,
          conversation: result.conversation || 0,
          other: result.other || 0,
        });
        setOrphanedCount(result.orphaned ?? 0);
      } else {
        setTotalCounts({
          person: 0,
          event: 0,
          relationship: 0,
          promise: 0,
          conversation: 0,
          other: 0,
        });
        setOrphanedCount(0);
      }
    } catch (err) {
      console.error("Failed to fetch counts:", err);
    } finally {
      setCountsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // Track if we should refetch on focus (only after initial load)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

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
        conversation: ITEMS_PER_TYPE,
        other: ITEMS_PER_TYPE,
      });

      try {
        const typesToFetch = activeTypes.size > 0
          ? Array.from(activeTypes)
          : (Object.keys(TYPE_CONFIG) as ObjectType[]);

        // Fetch types and starred objects in parallel
        const [typeResults, starred] = await Promise.all([
          Promise.all(
            typesToFetch.map(async (type) => ({
              type,
              objects: await fetchTypeObjects(type, ITEMS_PER_TYPE),
            }))
          ),
          fetchStarredObjects(),
        ]);

        const newObjectsByType: Record<ObjectType, ObjectWithRelations[]> = {
          person: [],
          event: [],
          relationship: [],
          promise: [],
          conversation: [],
          other: [],
        };

        for (const { type, objects } of typeResults) {
          newObjectsByType[type] = objects;
        }

        setObjectsByType(newObjectsByType);
        setStarredObjects(starred);
        setHasLoadedOnce(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch objects");
      } finally {
        setLoading(false);
      }
    };

    fetchAllTypes();
  }, [q, sortBy, activeTypesParam, showOrphanedOnly, fetchTypeObjects, fetchStarredObjects]);

  // Ref to track if a refetch is in progress (to avoid overlapping fetches)
  const isRefetchingRef = useRef(false);

  // Refetch data when page regains focus (e.g., navigating back from detail page)
  const refetchCurrentData = useCallback(async () => {
    // Avoid overlapping refetches, but don't skip if main loading is true
    if (isRefetchingRef.current) return;
    isRefetchingRef.current = true;

    try {
      const typesToFetch = activeTypes.size > 0
        ? Array.from(activeTypes)
        : (Object.keys(TYPE_CONFIG) as ObjectType[]);

      // Fetch types and starred objects in parallel
      const [typeResults, starred] = await Promise.all([
        Promise.all(
          typesToFetch.map(async (type) => ({
            type,
            objects: await fetchTypeObjects(type, limits[type] || ITEMS_PER_TYPE),
          }))
        ),
        fetchStarredObjects(),
      ]);

      const newObjectsByType: Record<ObjectType, ObjectWithRelations[]> = {
        person: [],
        event: [],
        relationship: [],
        promise: [],
        conversation: [],
        other: [],
      };

      for (const { type, objects } of typeResults) {
        newObjectsByType[type] = objects;
      }

      setObjectsByType(newObjectsByType);
      setStarredObjects(starred);
    } catch (err) {
      console.error("Failed to refetch objects:", err);
    } finally {
      isRefetchingRef.current = false;
    }
  }, [activeTypes, limits, fetchTypeObjects, fetchStarredObjects]);

  // Track navigation to refetch when coming back to this page
  const location = useLocation();
  const lastLocationKeyRef = useRef<string | null>(null);

  // Refetch when navigating back to this page (location.key changes)
  useEffect(() => {
    // Skip if we haven't loaded once yet
    if (!hasLoadedOnce) {
      lastLocationKeyRef.current = location.key;
      return;
    }

    // If the location key changed, we navigated (could be back from detail page)
    if (lastLocationKeyRef.current !== null && lastLocationKeyRef.current !== location.key) {
      refetchCurrentData();
      fetchCounts();
    }

    lastLocationKeyRef.current = location.key;
  }, [location.key, hasLoadedOnce, refetchCurrentData, fetchCounts]);

  // Also refetch when browser tab regains visibility
  useEffect(() => {
    if (!hasLoadedOnce) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetchCurrentData();
        fetchCounts();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasLoadedOnce, refetchCurrentData, fetchCounts]);

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

  // Toggle star on an object
  const toggleStar = useCallback(async (objectId: string, currentStarred: boolean) => {
    const newStarred = !currentStarred;
    
    // Optimistically update the UI - update both objectsByType and starredObjects
    setObjectsByType((prev) => {
      const updated = { ...prev };
      for (const type of Object.keys(updated) as ObjectType[]) {
        updated[type] = updated[type].map((obj) =>
          obj._id.toString() === objectId
            ? { ...obj, starred: newStarred }
            : obj
        );
      }
      return updated;
    });
    
    // Update starred objects list
    if (newStarred) {
      // Find the object from objectsByType and add to starred
      setStarredObjects((prev) => {
        const alreadyExists = prev.some((obj) => obj._id.toString() === objectId);
        if (alreadyExists) return prev;
        
        // Find the object in objectsByType
        for (const type of Object.keys(objectsByType) as ObjectType[]) {
          const found = objectsByType[type].find((obj) => obj._id.toString() === objectId);
          if (found) {
            return [{ ...found, starred: true }, ...prev];
          }
        }
        return prev;
      });
    } else {
      // Remove from starred
      setStarredObjects((prev) => prev.filter((obj) => obj._id.toString() !== objectId));
    }

    try {
      // Get current version first
      const current = await callResource("objects", {
        action: "get",
        id: objectId,
      });
      
      await callResource("objects", {
        action: "update",
        id: objectId,
        version: current.version ?? 0,
        field: "starred",
        value: newStarred,
      });
    } catch (err) {
      console.error("Failed to toggle star:", err);
      // Revert on error
      setObjectsByType((prev) => {
        const updated = { ...prev };
        for (const type of Object.keys(updated) as ObjectType[]) {
          updated[type] = updated[type].map((obj) =>
            obj._id.toString() === objectId
              ? { ...obj, starred: currentStarred }
              : obj
          );
        }
        return updated;
      });
      // Also revert starred objects - refetch to be safe
      fetchStarredObjects().then(setStarredObjects).catch(console.error);
    }
  }, [objectsByType, fetchStarredObjects]);

  useEffect(() => {
    setLocalQ(q);
  }, [q]);

  function updateFilters(
    newQ: string,
    newTypes: Set<ObjectType>,
    newSort: SortOption,
    orphaned?: boolean,
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

    if (orphaned !== undefined) {
      if (orphaned) {
        newSearchParams.set("orphaned", "true");
      } else {
        newSearchParams.delete("orphaned");
      }
    } else if (showOrphanedOnly) {
      newSearchParams.set("orphaned", "true");
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
    updateFilters(q, newTypes, sortBy, showOrphanedOnly);
  }

  function toggleOrphaned() {
    updateFilters(q, activeTypes, sortBy, !showOrphanedOnly);
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

  const hasActiveFilters = q.trim() || activeTypes.size > 0 || showOrphanedOnly;

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
          updateFilters(localQ, activeTypes, sortBy, showOrphanedOnly);
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

        {/* Orphaned filter */}
        <Button
          variant={showOrphanedOnly ? "secondary" : "outline"}
          size="sm"
          onClick={toggleOrphaned}
          className="flex items-center gap-2"
        >
          {showOrphanedOnly ? (
            <>
              <Link2Off className="w-4 h-4" />
              Orphaned Only
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4" />
              Show Orphaned
            </>
          )}
          <Badge variant="secondary" className="text-xs ml-1">
            {countsLoading ? "..." : (orphanedCount ?? 0)}
          </Badge>
        </Button>

        {/* Refresh counts button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchCounts(true)}
          disabled={countsLoading}
          className="flex items-center gap-1"
          title="Refresh counts"
        >
          <RefreshCw className={`w-4 h-4 ${countsLoading ? 'animate-spin' : ''}`} />
        </Button>

        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-sm text-muted-foreground">Sort:</Label>
          <Select
            value={sortBy}
            onValueChange={(value: SortOption) =>
              updateFilters(q, activeTypes, value, showOrphanedOnly)
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
          {/* Starred Section - shown at top if there are starred objects */}
          {starredObjects.length > 0 && (
            <Collapsible
              open={!starredCollapsed}
              onOpenChange={() => setStarredCollapsed(!starredCollapsed)}
            >
              <div className="border rounded-lg border-yellow-200 bg-yellow-50/30 dark:border-yellow-900/50 dark:bg-yellow-900/10">
                <div className="flex items-center p-4 gap-2">
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-2 flex-1 hover:bg-muted/50 -m-2 p-2 rounded transition-colors text-left">
                      {starredCollapsed ? (
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                      <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                      <h2 className="text-lg font-semibold">Starred</h2>
                      <Badge variant="outline" className="font-semibold">
                        {starredObjects.length}
                      </Badge>
                      <div className="flex-1" />
                    </button>
                  </CollapsibleTrigger>
                </div>
                
                <CollapsibleContent>
                  <div className="p-4 pt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {starredObjects.map((object) => (
                        <ObjectCard
                          key={object._id.toString()}
                          object={object}
                          searchQuery={q}
                          showType={true}
                          onToggleStar={toggleStar}
                        />
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {visibleTypes.map((type) => {
            const typeObjects = objectsByType[type];
            const config = TYPE_CONFIG[type];
            const Icon = config.icon;
            const total = totalCounts[type];
            const loaded = typeObjects.length;
            const hasMore = loaded < total;
            const isCollapsed = collapsed[type];
            const isLoadingMore = loadingTypes.has(type);
            const currentSort = sectionSort[type];
            const showTimeSort = type === "conversation" || type === "event";

            // Sort objects based on section sort option
            const sortedObjects = currentSort === "default"
              ? typeObjects
              : [...typeObjects].sort((a, b) => {
                  const aTime = a.timeRanges?.[0]?.start;
                  const bTime = b.timeRanges?.[0]?.start;

                  if (!aTime && !bTime) return 0;
                  if (!aTime) return 1;
                  if (!bTime) return -1;

                  const aDate = typeof aTime === "string" ? new Date(aTime) : aTime;
                  const bDate = typeof bTime === "string" ? new Date(bTime) : bTime;

                  return currentSort === "chronological"
                    ? aDate.getTime() - bDate.getTime()  // Oldest first
                    : bDate.getTime() - aDate.getTime(); // Newest first
                });

            return (
              <Collapsible
                key={type}
                open={!isCollapsed}
                onOpenChange={() => toggleCollapsed(type)}
              >
                <div className="border rounded-lg">
                  <div className="flex items-center p-4 gap-2">
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 flex-1 hover:bg-muted/50 -m-2 p-2 rounded transition-colors text-left">
                        {isCollapsed ? (
                          <ChevronRight className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-muted-foreground" />
                        )}
                        <Icon className="w-5 h-5 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">{config.label}</h2>
                        <Badge variant="outline" className="font-semibold">
                          {loaded < total ? `${loaded} / ${total}` : total}
                        </Badge>
                        <div className="flex-1" />
                      </button>
                    </CollapsibleTrigger>

                    {/* Time-based sort toggle for conversations/events */}
                    {showTimeSort && !isCollapsed && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant={currentSort === "chronological-desc" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSectionSort(prev => ({ ...prev, [type]: "chronological-desc" }));
                          }}
                          title="Newest first"
                        >
                          <SortDesc className="w-3 h-3 mr-1" />
                          Newest
                        </Button>
                        <Button
                          variant={currentSort === "chronological" ? "secondary" : "ghost"}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSectionSort(prev => ({ ...prev, [type]: "chronological" }));
                          }}
                          title="Oldest first"
                        >
                          <SortAsc className="w-3 h-3 mr-1" />
                          Oldest
                        </Button>
                      </div>
                    )}
                  </div>

                  <CollapsibleContent>
                    <div className="p-4 pt-0">
                      {typeObjects.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          Loading...
                        </p>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {sortedObjects.map((object) => (
                              <ObjectCard
                                key={object._id.toString()}
                                object={object}
                                searchQuery={q}
                                showType={false}
                                onToggleStar={toggleStar}
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
