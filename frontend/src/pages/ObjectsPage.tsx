import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { toast } from "sonner";
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
  Tag,
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
): "person" | "event" | "relationship" | "promise" | "conversation" | "tag" | "other" {
  if (object.isPromise) return "promise";
  if (object.isTag) return "tag";
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
  tag: {
    label: "Tags",
    icon: Tag,
    color: "bg-pink-100 text-pink-800 border-pink-200",
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
    tags?: Array<{ _id: string; name?: string; icon?: unknown; color?: string }>;
    linkedObjectsCount?: number; // For tags: number of objects linked to this tag
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
      <Card className="p-2 hover:border-primary transition-colors h-full relative group/card">
        {/* Star button - top right corner, always visible */}
        {onToggleStar && (
          <button
            type="button"
            onClick={handleStarClick}
            className={`absolute top-1.5 right-1.5 p-0.5 rounded transition-colors ${
              object.starred
                ? "text-yellow-500 hover:text-yellow-600"
                : "text-muted-foreground/40 hover:text-yellow-500"
            }`}
            title={object.starred ? "Remove from starred" : "Add to starred"}
          >
            <Star className={`w-3.5 h-3.5 ${object.starred ? "fill-current" : ""}`} />
          </button>
        )}
        <div className="space-y-1">
          {/* Header with icon and name */}
          <div className="flex items-center gap-2 min-w-0 pr-5">
            <span
              className="text-base flex-shrink-0 w-6 h-6 flex items-center justify-center rounded"
              style={{ backgroundColor: object.color ? `${object.color}20` : undefined }}
            >
              {renderIcon(object.icon)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-sm truncate">
                  {searchQuery.trim() && object.name
                    ? renderHighlightedText(object.name, searchQuery.trim())
                    : object.name || "Unnamed"}
                </span>
                {showType && (
                  <Badge variant="outline" className={`text-[10px] px-1 py-0 ${typeConfig.color}`}>
                    {objectType === "other" ? "Object" : objectType}
                  </Badge>
                )}
                {/* Show linked objects count for tags */}
                {objectType === "tag" && object.linkedObjectsCount !== undefined && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {object.linkedObjectsCount} {object.linkedObjectsCount === 1 ? "object" : "objects"}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Relationship info - compact */}
          {isRelationship && hasRelationshipData && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-8 truncate">
              <span>{object.subjectObject?.name}</span>
              {object.relationship?.symmetrical
                ? <ArrowLeftRight className="w-3 h-3 flex-shrink-0" />
                : <ArrowRight className="w-3 h-3 flex-shrink-0" />}
              <span className="truncate">{object.objectObject?.name}</span>
            </div>
          )}

          {/* Details - truncated to 2 lines */}
          {object.details && !isRelationship && (
            <div className="text-xs text-muted-foreground pl-8 line-clamp-2">
              {object.details}
            </div>
          )}

          {/* Metadata row - compact */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-8 flex-wrap">
            {/* Conversation: duration and time */}
            {isConversation && timeRangeInfo && (
              <>
                <span>{timeRangeInfo.duration}</span>
                <span className="text-muted-foreground/50">·</span>
                <span>{timeRangeInfo.startDateTime}</span>
              </>
            )}
            {/* Non-conversation: date range */}
            {!isConversation && timeRangeInfo && (
              <div className="flex items-center gap-1">
                <CalendarClock className="w-2.5 h-2.5" />
                <span>{timeRangeInfo.startFormatted}</span>
                {timeRangeInfo.count > 1 && (
                  <span className="text-muted-foreground/60">(+{timeRangeInfo.count - 1})</span>
                )}
              </div>
            )}
            {/* Aliases - show only if no details */}
            {object.aliases && object.aliases.length > 0 && !object.details && !isConversation && (
              <span className="truncate">aka {object.aliases.slice(0, 2).join(", ")}</span>
            )}
          </div>
          
          {/* Tags row */}
          {object.tags && object.tags.length > 0 && (
            <div className="flex items-center gap-1 pl-8 flex-wrap">
              <Tag className="w-2.5 h-2.5 text-muted-foreground" />
              {object.tags.slice(0, 3).map((tag: { _id: string; name?: string; color?: string }) => (
                <Badge
                  key={tag._id}
                  variant="outline"
                  className="text-[10px] px-1 py-0"
                  style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
                >
                  {tag.name || "Unnamed"}
                </Badge>
              ))}
              {object.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{object.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

type ObjectType = "person" | "event" | "relationship" | "promise" | "conversation" | "tag" | "other";
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
  tags?: Array<{ _id: string; name?: string; icon?: unknown; color?: string }>;
  linkedObjectsCount?: number; // For tags: number of objects linked to this tag
};

const ITEMS_PER_TYPE = 9; // Initial items per type (3 rows of 3)
const LOAD_MORE_COUNT = 30; // Items to load when clicking "load more"
const MAX_ITEMS_PER_TYPE = 300; // Maximum items per type for "load all"

const ObjectsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // Objects grouped by type
  const [objectsByType, setObjectsByType] = useState<Record<ObjectType, ObjectWithRelations[]>>({
    person: [],
    event: [],
    relationship: [],
    promise: [],
    conversation: [],
    tag: [],
    other: [],
  });
  const [loadingTypes, setLoadingTypes] = useState<Set<ObjectType>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Note: loading state is now per-type via loadingTypes, not global
  
  // Track which types have been fetched (for lazy loading)
  const [fetchedTypes, setFetchedTypes] = useState<Set<ObjectType>>(new Set());

  // How many items to show per type
  const [limits, setLimits] = useState<Record<ObjectType, number>>({
    person: ITEMS_PER_TYPE,
    event: ITEMS_PER_TYPE,
    relationship: ITEMS_PER_TYPE,
    promise: ITEMS_PER_TYPE,
    conversation: ITEMS_PER_TYPE,
    tag: ITEMS_PER_TYPE,
    other: ITEMS_PER_TYPE,
  });

  // Collapsed state per type - start expanded by default
  const [collapsed, setCollapsed] = useState<Record<ObjectType, boolean>>({
    person: false,
    event: false,
    relationship: false,
    promise: false,
    conversation: false,
    tag: false,
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
    tag: "default",
    other: "default",
  });

  // Total counts per type from database
  const [totalCounts, setTotalCounts] = useState<Record<ObjectType, number>>({
    person: 0,
    event: 0,
    relationship: 0,
    promise: 0,
    conversation: 0,
    tag: 0,
    other: 0,
  });
  const [countsLoading, setCountsLoading] = useState(true);
  const [orphanedCount, setOrphanedCount] = useState<number | null>(null);
  
  // Track whether there might be more items per type (when filtering, we don't know exact total)
  const [mightHaveMore, setMightHaveMore] = useState<Record<ObjectType, boolean>>({
    person: false,
    event: false,
    relationship: false,
    promise: false,
    conversation: false,
    tag: false,
    other: false,
  });
  
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
        return { isRelationship: true, isPromise: { $ne: true }, isTag: { $ne: true } };
      case "promise":
        return { isPromise: true };
      case "conversation":
        return { isConversation: true };
      case "tag":
        return { isTag: true };
      case "other":
        return {
          isPerson: { $ne: true },
          isEvent: { $ne: true },
          isRelationship: { $ne: true },
          isPromise: { $ne: true },
          isConversation: { $ne: true },
          isTag: { $ne: true },
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
      
      // For tags, count how many objects are linked to this tag
      if (type === "tag") {
        pipeline.push({
          $lookup: {
            from: "objects",
            let: { tagId: "$_id" },
            pipeline: [
              {
                $match: {
                  isTag: true,
                  $expr: { $eq: ["$relationship.subject", "$$tagId"] },
                },
              },
            ],
            as: "linkedTagRelationships",
          },
        });
        pipeline.push({
          $addFields: {
            linkedObjectsCount: { $size: "$linkedTagRelationships" },
          },
        });
        // Clean up the array - we only need the count
        pipeline.push({
          $project: {
            linkedTagRelationships: 0,
          },
        });
      }
      
      // Fetch tags for all non-relationship/non-tag objects
      if (type !== "relationship" && type !== "tag") {
        pipeline.push({
          $lookup: {
            from: "objects",
            let: { objectId: "$_id" },
            pipeline: [
              {
                $match: {
                  isTag: true,
                  $expr: { $eq: ["$relationship.object", "$$objectId"] },
                },
              },
              { $limit: 5 }, // Limit to 5 tags per object
              {
                $lookup: {
                  from: "objects",
                  localField: "relationship.subject",
                  foreignField: "_id",
                  as: "tagObject",
                },
              },
              { $unwind: { path: "$tagObject", preserveNullAndEmptyArrays: true } },
              {
                $project: {
                  _id: "$tagObject._id",
                  name: "$tagObject.name",
                  icon: "$tagObject.icon",
                  color: "$tagObject.color",
                },
              },
            ],
            as: "tags",
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

  // Fetch starred objects - always fetch all starred regardless of search filter
  // Starred section acts as "favorites" that should always be visible
  const fetchStarredObjects = useCallback(async (): Promise<ObjectWithRelations[]> => {
    const searchMatch: Record<string, unknown> = { starred: true };
    // Note: We intentionally don't apply search filter to starred objects
    // The starred section should always show all favorites regardless of search

    const pipeline: unknown[] = [
      { $match: searchMatch },
      { $sort: { updatedAt: -1, _id: -1 } }, // Always sort by most recently updated
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
      // Fetch tags for starred objects
      {
        $lookup: {
          from: "objects",
          let: { objectId: "$_id" },
          pipeline: [
            {
              $match: {
                isTag: true,
                $expr: { $eq: ["$relationship.object", "$$objectId"] },
              },
            },
            { $limit: 5 },
            {
              $lookup: {
                from: "objects",
                localField: "relationship.subject",
                foreignField: "_id",
                as: "tagObject",
              },
            },
            { $unwind: { path: "$tagObject", preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: "$tagObject._id",
                name: "$tagObject.name",
                icon: "$tagObject.icon",
                color: "$tagObject.color",
              },
            },
          ],
          as: "tags",
        },
      },
    ];

    return await callResource("mongo", {
      action: "aggregate",
      collection: "objects",
      pipeline,
    });
  }, []); // No dependencies - starred objects don't depend on search/sort

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
          tag: result.tag || 0,
          other: result.other || 0,
        });
        // Orphaned might be null if calculating in background
        setOrphanedCount(result.orphaned ?? null);
        
        // If orphaned was loading, poll for it after a delay
        if (result.orphanedLoading || result.orphaned === null) {
          setTimeout(async () => {
            try {
              const updated = await callResource("objects", {
                action: "getCounts",
                forceRefresh: false,
              });
              if (updated?.orphaned != null) {
                setOrphanedCount(updated.orphaned);
              }
            } catch {
              // Ignore errors in background poll
            }
          }, 3000); // Check again after 3 seconds
        }
      } else {
        setTotalCounts({
          person: 0,
          event: 0,
          relationship: 0,
          promise: 0,
          conversation: 0,
          tag: 0,
          other: 0,
        });
        setOrphanedCount(null);
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

  // Fetch objects for a type when it's expanded (lazy loading)
  const fetchTypeIfNeeded = useCallback(async (type: ObjectType) => {
    // Skip if already fetched or currently loading
    if (fetchedTypes.has(type) || loadingTypes.has(type)) return;
    
    setLoadingTypes(prev => new Set(prev).add(type));
    const limit = limits[type] || ITEMS_PER_TYPE;
    
    try {
      const objects = await fetchTypeObjects(type, limit);
      setObjectsByType(prev => ({ ...prev, [type]: objects }));
      setFetchedTypes(prev => new Set(prev).add(type));
      // Track if there might be more (if we got exactly the limit, there could be more)
      setMightHaveMore(prev => ({ ...prev, [type]: objects.length >= limit }));
    } catch (err) {
      console.error(`Failed to fetch ${type}:`, err);
    } finally {
      setLoadingTypes(prev => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  }, [fetchedTypes, loadingTypes, limits, fetchTypeObjects]);

  // Fetch starred objects on initial load
  useEffect(() => {
    const fetchStarred = async () => {
      try {
        const starred = await fetchStarredObjects();
        setStarredObjects(starred);
        setHasLoadedOnce(true);
      } catch (err) {
        console.error("Failed to fetch starred objects:", err);
      }
    };
    fetchStarred();
  }, [fetchStarredObjects]);

  // When search/sort/filter changes, reset fetched types to refetch
  useEffect(() => {
    // Reset limits when search/sort changes
    setLimits({
      person: ITEMS_PER_TYPE,
      event: ITEMS_PER_TYPE,
      relationship: ITEMS_PER_TYPE,
      promise: ITEMS_PER_TYPE,
      conversation: ITEMS_PER_TYPE,
      tag: ITEMS_PER_TYPE,
      other: ITEMS_PER_TYPE,
    });
    
    // Reset mightHaveMore
    setMightHaveMore({
      person: false,
      event: false,
      relationship: false,
      promise: false,
      conversation: false,
      tag: false,
      other: false,
    });
    
    // Clear fetched types to trigger refetch when expanded
    setFetchedTypes(new Set());
    
    // Clear current objects
    setObjectsByType({
      person: [],
      event: [],
      relationship: [],
      promise: [],
      conversation: [],
      tag: [],
      other: [],
    });
  }, [q, sortBy, activeTypesParam, showOrphanedOnly]);

  // Fetch objects for expanded types
  useEffect(() => {
    const expandedTypes = (Object.keys(collapsed) as ObjectType[]).filter(type => !collapsed[type]);
    for (const type of expandedTypes) {
      fetchTypeIfNeeded(type);
    }
  }, [collapsed, fetchTypeIfNeeded]);

  // Ref to track if a refetch is in progress (to avoid overlapping fetches)
  const isRefetchingRef = useRef(false);

  // Refetch data when page regains focus (e.g., navigating back from detail page)
  // Only refetches expanded types for performance
  const refetchCurrentData = useCallback(async () => {
    // Avoid overlapping refetches
    if (isRefetchingRef.current) return;
    isRefetchingRef.current = true;

    try {
      // Only refetch expanded types that have been fetched before
      const expandedTypes = (Object.keys(collapsed) as ObjectType[]).filter(
        type => !collapsed[type] && fetchedTypes.has(type)
      );

      // Fetch expanded types and starred objects in parallel
      const [typeResults, starred] = await Promise.all([
        Promise.all(
          expandedTypes.map(async (type) => ({
            type,
            objects: await fetchTypeObjects(type, limits[type] || ITEMS_PER_TYPE),
          }))
        ),
        fetchStarredObjects(),
      ]);

      const newObjectsByType = { ...objectsByType };
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
  }, [collapsed, fetchedTypes, limits, fetchTypeObjects, fetchStarredObjects, objectsByType]);

  // Track navigation to refetch starred objects when coming back
  const location = useLocation();
  const lastLocationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip initial render
    if (lastLocationKeyRef.current === null) {
      lastLocationKeyRef.current = location.key;
      return;
    }

    // If location key changed, user navigated (e.g., back from detail page)
    if (lastLocationKeyRef.current !== location.key) {
      lastLocationKeyRef.current = location.key;
      // Always refetch starred objects when navigating back (fast query)
      fetchStarredObjects().then(setStarredObjects).catch(console.error);
      // Also refetch counts in case they changed
      fetchCounts();
    }
  }, [location.key, fetchStarredObjects, fetchCounts]);

  // Track last fetch time to avoid excessive refetches
  const lastFetchTimeRef = useRef<number>(Date.now());
  const MIN_REFETCH_INTERVAL = 30000; // 30 seconds minimum between refetches

  // Refetch when browser tab regains visibility (but not too often)
  useEffect(() => {
    if (!hasLoadedOnce) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        // Only refetch if it's been more than 30 seconds since last fetch
        if (now - lastFetchTimeRef.current > MIN_REFETCH_INTERVAL) {
          lastFetchTimeRef.current = now;
          refetchCurrentData();
          fetchCounts();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hasLoadedOnce, refetchCurrentData, fetchCounts]);

  // Load more for a specific type
  const loadMore = useCallback(async (type: ObjectType) => {
    const currentLimit = limits[type];
    const newLimit = Math.min(currentLimit + LOAD_MORE_COUNT, MAX_ITEMS_PER_TYPE);

    setLoadingTypes((prev) => new Set(prev).add(type));

    try {
      const objects = await fetchTypeObjects(type, newLimit);
      setObjectsByType((prev) => ({ ...prev, [type]: objects }));
      setLimits((prev) => ({ ...prev, [type]: newLimit }));
      // Update mightHaveMore: if we got fewer than requested, there are no more
      setMightHaveMore((prev) => ({ ...prev, [type]: objects.length >= newLimit }));
    } catch (err) {
      console.error(`Failed to load more ${type}:`, err);
    } finally {
      setLoadingTypes((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  }, [limits, fetchTypeObjects]);

  // Toggle star on an object
  const toggleStar = useCallback(async (objectId: string, currentStarred: boolean) => {
    const newStarred = !currentStarred;
    
    // Store the removed object for undo - we'll capture it via functional update
    let removedObject: ObjectWithRelations | undefined;
    // Store the found object when adding to starred
    let foundObject: ObjectWithRelations | undefined;
    
    // Optimistically update the UI - update both objectsByType and starredObjects
    setObjectsByType((prev) => {
      const updated = { ...prev };
      for (const type of Object.keys(updated) as ObjectType[]) {
        // While iterating, find the object if we're adding to starred
        if (newStarred && !foundObject) {
          const obj = updated[type].find((o) => o._id.toString() === objectId);
          if (obj) foundObject = obj;
        }
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
      // Add to starred using the object found during objectsByType update
      // Use a small delay to ensure foundObject is captured from the synchronous setObjectsByType callback
      setStarredObjects((prev) => {
        const alreadyExists = prev.some((obj) => obj._id.toString() === objectId);
        if (alreadyExists) return prev;
        if (foundObject) {
          return [{ ...foundObject, starred: true }, ...prev];
        }
        return prev;
      });
    } else {
      // Find and store the object before removing (for undo) using functional update
      setStarredObjects((prev) => {
        removedObject = prev.find((obj) => obj._id.toString() === objectId);
        return prev.filter((obj) => obj._id.toString() !== objectId);
      });
    }

    // Helper to revert changes
    const revertChanges = () => {
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
      if (removedObject) {
        setStarredObjects((prev) => [removedObject!, ...prev]);
      } else {
        setStarredObjects((prev) => prev.filter((obj) => obj._id.toString() !== objectId));
      }
    };

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

      // Show undo toast when removing from starred
      if (!newStarred && removedObject) {
        // Capture the object data at this moment for the undo action
        const capturedObject = { ...removedObject };
        toast("Removed from starred", {
          action: {
            label: "Undo",
            onClick: async () => {
              // Optimistically restore the object to starred
              setStarredObjects((prev) => [{ ...capturedObject, starred: true }, ...prev]);
              setObjectsByType((prev) => {
                const updated = { ...prev };
                for (const type of Object.keys(updated) as ObjectType[]) {
                  updated[type] = updated[type].map((obj) =>
                    obj._id.toString() === objectId
                      ? { ...obj, starred: true }
                      : obj
                  );
                }
                return updated;
              });
              
              try {
                // Get current version and update
                const current = await callResource("objects", {
                  action: "get",
                  id: objectId,
                });
                await callResource("objects", {
                  action: "update",
                  id: objectId,
                  version: current.version ?? 0,
                  field: "starred",
                  value: true,
                });
              } catch (err) {
                console.error("Failed to undo star removal:", err);
                // Revert the optimistic update
                setStarredObjects((prev) => prev.filter((obj) => obj._id.toString() !== objectId));
                setObjectsByType((prev) => {
                  const updated = { ...prev };
                  for (const type of Object.keys(updated) as ObjectType[]) {
                    updated[type] = updated[type].map((obj) =>
                      obj._id.toString() === objectId
                        ? { ...obj, starred: false }
                        : obj
                    );
                  }
                  return updated;
                });
                toast.error("Failed to restore starred status");
              }
            },
          },
          duration: 5000,
        });
      }
    } catch (err) {
      console.error("Failed to toggle star:", err);
      revertChanges();
      toast.error("Failed to update starred status");
    }
  }, []);

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
    // If expanding and not yet fetched, it will be fetched by the useEffect
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
  // Order: conversations first, then people, events, relationships, promises, tags, other
  const visibleTypes = useMemo(() => {
    const typeOrder: ObjectType[] = ["conversation", "person", "event", "relationship", "promise", "tag", "other"];
    
    if (activeTypes.size === 0) {
      // Show all types that have items (in database)
      return typeOrder.filter((type) => totalCounts[type] > 0);
    }
    // Show only selected types that have results
    return typeOrder.filter(
      (type) => activeTypes.has(type) && totalCounts[type] > 0
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
        <Button type="submit" disabled={loadingTypes.size > 0}>
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
            {countsLoading ? "..." : (orphanedCount === null ? "..." : orphanedCount)}
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
          {countsLoading
            ? "Loading counts..."
            : hasActiveFilters
              ? `${activeTypes.size > 0
                  ? Array.from(activeTypes).reduce((sum, t) => sum + totalCounts[t], 0)
                  : grandTotal
                } objects found`
              : `${grandTotal} objects in database`}
        </span>
        <span className="text-xs text-muted-foreground/60">
          (expand sections to load items)
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

      {/* Results */}
      {grandTotal === 0 && !countsLoading && (
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

      {(grandTotal > 0 || countsLoading) && (
        <div className="space-y-4">
          {/* Starred Section - shown at top if there are starred objects */}
          {starredObjects.length > 0 && (
            <Collapsible
              open={!starredCollapsed}
              onOpenChange={() => setStarredCollapsed(!starredCollapsed)}
            >
              <div id="starred-section" className="border rounded-lg border-yellow-200 bg-yellow-50/30 dark:border-yellow-900/50 dark:bg-yellow-900/10">
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
                  <div className="p-3 pt-0">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
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
            const loaded = typeObjects.length;
            // When filtering, use mightHaveMore; otherwise compare against total
            const hasActiveFilter = q.trim() || showOrphanedOnly;
            const hasMore = hasActiveFilter ? mightHaveMore[type] : (loaded < totalCounts[type]);
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
                          {hasActiveFilter 
                            ? (hasMore ? `${loaded}+` : loaded)
                            : (loaded < totalCounts[type] ? `${loaded} / ${totalCounts[type]}` : totalCounts[type])
                          }
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
                    <div className="p-3 pt-0">
                      {(isLoadingMore && !fetchedTypes.has(type)) || (typeObjects.length === 0 && loadingTypes.has(type)) ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          Loading {config.label.toLowerCase()}...
                        </p>
                      ) : typeObjects.length === 0 && fetchedTypes.has(type) ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No {config.label.toLowerCase()} found
                        </p>
                      ) : typeObjects.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          Loading...
                        </p>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                            {sortedObjects.map((object) => (
                              <ObjectCard
                                key={object._id.toString()}
                                object={object}
                                searchQuery={q}
                                showType={true}
                                onToggleStar={toggleStar}
                              />
                            ))}
                          </div>

                          {hasMore && (
                            <div className="mt-3 flex items-center justify-center">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => loadMore(type)}
                                disabled={isLoadingMore}
                              >
                                {isLoadingMore ? "Loading..." : `Load more`}
                              </Button>
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
