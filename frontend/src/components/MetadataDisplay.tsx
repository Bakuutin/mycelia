import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Object } from "@/types/objects";
import { formatTime } from "@/lib/formatTime";
import {
  Calendar,
  CalendarClock,
  Clock,
  Handshake,
  MessageSquare,
  Package,
  Timer,
  User,
  Users,
  LineChart,
  Pencil,
} from "lucide-react";

interface MetadataDisplayProps {
  object: Object;
  /** Hide the object type card when already displayed elsewhere */
  hideObjectType?: boolean;
  /** Hide time information when player is already visible */
  hideTimeInfo?: boolean;
  /** Hide metadata (created, updated, version) when displayed elsewhere */
  hideMetadata?: boolean;
  /** Callback when Edit button is clicked for time ranges */
  onEditTimeRanges?: () => void;
  /** Use compact layout with smaller text and spacing */
  compact?: boolean;
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
  
  if (diffMins < 1) return "< 1 minute";
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
  if (diffHours < 24) {
    const mins = diffMins % 60;
    return mins > 0 ? `${diffHours}h ${mins}m` : `${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  }
  if (diffDays < 7) {
    const hours = diffHours % 24;
    return hours > 0 ? `${diffDays}d ${hours}h` : `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  }
  return `${diffDays} days`;
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatTime(d, "gregorian-local-natural");
}

function getObjectType(object: Object): {
  type: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
} {
  if (object.isPromise) return { type: "Promise", icon: Handshake, color: "bg-orange-100 text-orange-800 border-orange-200" };
  if (object.isRelationship) return { type: "Relationship", icon: Users, color: "bg-purple-100 text-purple-800 border-purple-200" };
  if (object.isConversation) return { type: "Conversation", icon: MessageSquare, color: "bg-cyan-100 text-cyan-800 border-cyan-200" };
  if (object.isPerson) return { type: "Person", icon: User, color: "bg-blue-100 text-blue-800 border-blue-200" };
  if (object.isEvent) return { type: "Event", icon: Calendar, color: "bg-green-100 text-green-800 border-green-200" };
  return { type: "Object", icon: Package, color: "bg-gray-100 text-gray-800 border-gray-200" };
}

export function MetadataDisplay({ object, hideObjectType, hideTimeInfo, hideMetadata, onEditTimeRanges, compact = false }: MetadataDisplayProps) {
  const extractedWith = object?.metadata?.extractedWith;
  const timeRanges = object?.timeRanges;
  const hasTimeRange = timeRanges && timeRanges.length > 0;
  const firstRange = hasTimeRange ? timeRanges[0] : null;
  const typeInfo = getObjectType(object);
  const TypeIcon = typeInfo.icon;

  return (
    <div className="space-y-4">
      {/* Object Type Badge - hidden when displayed elsewhere */}
      {!hideObjectType && (
        <Card className="p-4 bg-muted/50">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            Object Type
          </h3>
          <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border ${typeInfo.color}`}>
            <TypeIcon className="w-4 h-4" />
            <span className="font-medium">{typeInfo.type}</span>
          </div>
        </Card>
      )}

      {/* Time Information - prominent display for conversations/events */}
      {!hideTimeInfo && hasTimeRange && firstRange && (
        <Card className="p-4 bg-muted/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Time Information
            </h3>
            {onEditTimeRanges && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={onEditTimeRanges}
              >
                <Pencil className="w-3.5 h-3.5 mr-1" />
                Edit
              </Button>
            )}
          </div>
          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <CalendarClock className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <dt className="text-muted-foreground text-xs">Started</dt>
                <dd className="text-foreground font-medium">
                  {formatDateTime(firstRange.start)}
                </dd>
              </div>
            </div>
            
            {firstRange.end ? (
              <div className="flex items-start gap-3">
                <CalendarClock className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <dt className="text-muted-foreground text-xs">Ended</dt>
                  <dd className="text-foreground font-medium">
                    {formatDateTime(firstRange.end)}
                  </dd>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-muted-foreground mt-0.5 animate-pulse" />
                <div className="flex-1">
                  <dt className="text-muted-foreground text-xs">Status</dt>
                  <dd className="text-foreground font-medium">
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      Ongoing
                    </Badge>
                  </dd>
                </div>
              </div>
            )}
            
            <div className="flex items-start gap-3">
              <Timer className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <dt className="text-muted-foreground text-xs">Duration</dt>
                <dd className="text-foreground font-medium text-lg">
                  {formatDuration(firstRange.start, firstRange.end)}
                </dd>
              </div>
            </div>

            <div className="pt-2 border-t">
              <Link
                to={
                  firstRange.end
                    ? `/timeline?start=${new Date(firstRange.start).getTime()}&end=${new Date(firstRange.end).getTime()}`
                    : `/timeline?start=${new Date(firstRange.start).getTime()}`
                }
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <LineChart className="w-4 h-4" />
                View on timeline
              </Link>
            </div>

            {timeRanges.length > 1 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  + {timeRanges.length - 1} more time range{timeRanges.length > 2 ? "s" : ""}
                </p>
              </div>
            )}
          </dl>
        </Card>
      )}

      {/* General Metadata */}
      {!hideMetadata && (
        <Card className="p-4 bg-muted/50">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            Metadata
          </h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Created:</dt>
              <dd className="text-foreground">
                {formatTime(new Date(object.createdAt))}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Updated:</dt>
              <dd className="text-foreground">
                {formatTime(new Date(object.updatedAt))}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Version:</dt>
              <dd className="text-foreground">
                {(object?.version || 0 ) as number}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {extractedWith && (
        <Card className="p-4 bg-muted/50">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            Extraction Metadata
          </h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Model:</dt>
              <dd className="font-mono text-foreground">
                {extractedWith.model}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">Extracted:</dt>
              <dd className="text-foreground">
                {formatTime(new Date(extractedWith.timestamp))}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
