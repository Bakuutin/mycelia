import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { SmartBackButton } from "@/components/SmartBackButton";
import {
  useObject,
  useObjectHistory,
  useUpdateObject,
  objectKeys,
} from "@/hooks/useObjectQueries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { formatTime } from "@/lib/formatTime";
import { EJSON } from "bson";
import { useMemo, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useQueryClient } from "@tanstack/react-query";

import yaml from "yaml";

interface HistoryEntry {
  _id: string;
  objectId: string;
  action: "create" | "update" | "delete";
  timestamp: Date;
  userId: string;
  version: number;
  field: string | null;
  oldValue: any;
  newValue: any;
}


function removeEmptyValues(value: any): any {
  if (value === undefined || value === null || value === "") return null;

  if (Array.isArray(value)) {
    const result = value.map(removeEmptyValues).filter(v => v !== null);
    return result.length > 0 ? result : null;
  }
  if (typeof value === "object" && value !== null) {
    const result = Object.fromEntries(Object.entries(value).filter(([_, v]) => v !== undefined && v !== null).map(([k, v]) => [k, removeEmptyValues(v)]));
    return Object.keys(result).length > 0 ? result : null;
  }
  
  return value;
}


function formatValue(value: any): string {
  return yaml
    .stringify(removeEmptyValues(EJSON.serialize(value)), {
      indent: 2,
      sortMapEntries: true,
    })
    .trim();
}

function getActionBadgeVariant(action: string) {
  switch (action) {
    case "create":
      return "default";
    case "update":
      return "secondary";
    case "delete":
      return "destructive";
    default:
      return "outline";
  }
}

// Group history entries that are within 1 minute of each other
function groupHistoryEntries(entries: HistoryEntry[]): (HistoryEntry | HistoryEntry[])[] {
  if (entries.length === 0) return [];
  
  const groups: (HistoryEntry | HistoryEntry[])[] = [];
  let currentGroup: HistoryEntry[] = [entries[0]];
  
  for (let i = 1; i < entries.length; i++) {
    const prevEntry = entries[i - 1];
    const currentEntry = entries[i];
    
    const prevTime = prevEntry.timestamp instanceof Date
      ? prevEntry.timestamp.getTime()
      : new Date(prevEntry.timestamp).getTime();
    const currentTime = currentEntry.timestamp instanceof Date
      ? currentEntry.timestamp.getTime()
      : new Date(currentEntry.timestamp).getTime();
    
    const timeDiff = Math.abs(currentTime - prevTime);
    const oneMinute = 60 * 1000;
    
    if (timeDiff <= oneMinute && prevEntry.action === "update" && currentEntry.action === "update") {
      // Add to current group
      currentGroup.push(currentEntry);
    } else {
      // Finalize current group
      if (currentGroup.length === 1) {
        groups.push(currentGroup[0]);
      } else {
        groups.push([...currentGroup]);
      }
      // Start new group
      currentGroup = [currentEntry];
    }
  }
  
  // Finalize last group
  if (currentGroup.length === 1) {
    groups.push(currentGroup[0]);
  } else {
    groups.push([...currentGroup]);
  }
  
  return groups;
}

// Get the initial state (before) and final state (after) from a group of entries
function getGroupedState(group: HistoryEntry[]): {
  before: Record<string, any>;
  after: Record<string, any>;
  entries: HistoryEntry[];
} {
  // For updates, we want to show the state before the first change and after the last change
  // We'll collect all field changes into a single before/after object
  const before: Record<string, any> = {};
  const after: Record<string, any> = {};
  
  // Process entries in chronological order
  const sortedGroup = [...group].sort((a, b) => {
    const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
    const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
    return timeB - timeA;
  });

  const reversedGroup = [...sortedGroup].reverse();
  
  reversedGroup.forEach(entry => {
    if (entry.action === "update" && entry.field) {
      // Store the original old value if we haven't seen this field yet
      if (!(entry.field in before)) {
        before[entry.field] = entry.oldValue;
      }
      // Always update the after value to the latest new value
      after[entry.field] = entry.newValue;
    }
  });
  
  return { before, after, entries: sortedGroup };
}

function CodeBlock({ value, variant = "before" }: { value: any; variant?: "before" | "after" }) {
  const formatted = useMemo(() => formatValue(value), [value]);
  const isEmpty = formatted === 'null';
  const isBefore = variant === "before";
  return (
    <div className={isBefore
      ? "bg-red-50 dark:bg-red-950/20 p-2 rounded border border-red-200 dark:border-red-900"
      : "bg-green-50 dark:bg-green-950/20 p-2 rounded border border-green-200 dark:border-green-900"
    }>
      {isEmpty ? (
        <pre className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
          (empty)
        </pre>
      ) : (
        <pre className="text-xs whitespace-pre-wrap break-words">
          {formatted}
        </pre>
      )}
    </div>
  );
}

function HistoryEntryCard({
  entry,
  onRestore,
  isRestoring,
  canRestore,
}: {
  entry: HistoryEntry;
  onRestore?: () => void;
  isRestoring?: boolean;
  canRestore?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={getActionBadgeVariant(entry.action)}>
            {entry.action}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Version {entry.version}
          </span>
          <span className="text-sm text-muted-foreground">
            by {entry.userId}
          </span>
          <span className="text-xs text-muted-foreground ml-auto">
            {formatTime(
              entry.timestamp instanceof Date
                ? entry.timestamp
                : new Date(entry.timestamp),
            )}
          </span>
        </div>

          {entry.action === "create" && (
            <div className="grid grid-cols-2 gap-4 text-sm" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div>
                <div className="font-medium text-muted-foreground mb-1">
                  Before:
                </div>
                <CodeBlock value={null} variant="before" />
              </div>
              <div>
                <div className="font-medium text-muted-foreground mb-1">
                  After:
                </div>
                <CodeBlock value={entry.newValue} variant="after" />
              </div>
            </div>
          )}

          {entry.action === "update" && entry.field && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-4 text-sm" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div>
                  <div className="font-medium text-muted-foreground mb-1">
                    Before:
                  </div>
                  <CodeBlock value={{ [entry.field]: entry.oldValue }} variant="before" />
                </div>
                <div>
                  <div className="font-medium text-muted-foreground mb-1">
                    After:
                  </div>
                  <CodeBlock value={{ [entry.field]: entry.newValue }} variant="after" />
                </div>
              </div>
            </div>
          )}

          {entry.action === "delete" && (
            <div className="grid grid-cols-2 gap-4 text-sm" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div>
                <div className="font-medium text-muted-foreground mb-1">
                  Before:
                </div>
                <CodeBlock value={entry.oldValue} variant="before" />
              </div>
              <div>
                <div className="font-medium text-muted-foreground mb-1">
                  After:
                </div>
                <CodeBlock value={null} variant="after" />
              </div>
            </div>
          )}

          {entry.action === "update" && entry.field && onRestore && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onRestore}
                disabled={!canRestore || isRestoring}
              >
                {isRestoring ? "Restoring..." : "Restore value"}
              </Button>
            </div>
          )}
      </div>
    </Card>
  );
}

function GroupedHistoryCard({
  group,
  onRestore,
  isRestoring,
  restoreKey,
  canRestore,
}: {
  group: HistoryEntry[];
  onRestore?: (changes: { field: string; value: any }[], groupId: string) => void;
  isRestoring?: boolean;
  restoreKey: string;
  canRestore?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { before, after, entries } = getGroupedState(group);
  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  
  const lastTime = lastEntry.timestamp instanceof Date
    ? lastEntry.timestamp
    : new Date(lastEntry.timestamp);
  
  return (
    <Card className="p-4">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">
              {group.length} updates
            </Badge>
            <span className="text-sm text-muted-foreground">
              Versions {firstEntry.version} - {lastEntry.version}
            </span>
            <span className="text-sm text-muted-foreground">
              by {firstEntry.userId}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              {formatDistanceToNow(lastTime, { addSuffix: true })}
            </span>
          </div>

            {onRestore && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRestore(
                    entries
                      .filter((entry) => entry.field)
                      .map((entry) => ({
                        field: entry.field!,
                        value: before[entry.field!] ?? null,
                      })),
                    restoreKey,
                  )}
                  disabled={!canRestore || isRestoring}
                >
                  {isRestoring ? "Restoring..." : "Restore to this state"}
                </Button>
              </div>
            )}

            {!isExpanded && (
              <div className="grid grid-cols-2 gap-4 text-sm" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div>
                  <div className="font-medium text-muted-foreground mb-1">
                    Before:
                  </div>
                  <CodeBlock value={before} variant="before" />
                </div>
                <div>
                  <div className="font-medium text-muted-foreground mb-1">
                    After:
                  </div>
                  <CodeBlock value={after} variant="after" />
                </div>
              </div>
            )}
            
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="mt-2">
                {isExpanded ? (
                  <>
                    <ChevronUp className="w-4 h-4 mr-2" />
                    Show Combined Changes
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 mr-2" />
                    Show Changes Separately ({group.length})
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
            
              <CollapsibleContent className="mt-4">
              <div className="pt-2 border-t space-y-4">
                <p className="text-sm font-medium mb-2 text-muted-foreground">
                  Individual changes:
                </p>
                {entries.map((entry) => (
                  <HistoryEntryCard
                    key={entry._id}
                    entry={entry}
                    onRestore={onRestore ? () => onRestore([
                      { field: entry.field!, value: entry.oldValue ?? null },
                    ], entry._id) : undefined}
                    isRestoring={isRestoring}
                    canRestore={canRestore}
                  />
                ))}
              </div>
            </CollapsibleContent>
        </div>
      </Collapsible>
    </Card>
  );
}

const ObjectHistoryPage = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: object, isLoading: objectLoading } = useObject(id);
  const updateObject = useUpdateObject();
  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
  } = useObjectHistory(id);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const handleRestore = async (
    changes: { field: string; value: any }[],
    key: string,
  ) => {
    if (!object || !id) return;

    setRestoreError(null);
    setRestoringKey(key);
    try {
      let version = object.version ?? 0;

      for (const change of changes) {
        const result = await updateObject.mutateAsync({
          id,
          version,
          field: change.field,
          value: change.value ?? null,
        });
        version = result.version ?? version + 1;
      }

      queryClient.invalidateQueries({ queryKey: objectKeys.history(id) });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to restore changes";
      setRestoreError(message);
    } finally {
      setRestoringKey(null);
    }
  };

  // Group history entries
  const groupedHistory = history ? groupHistoryEntries(history) : [];
  
  // Show history even if object is deleted, as long as history exists
  const hasHistory = history && history.length > 0;

  if (objectLoading && !hasHistory) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <SmartBackButton defaultPath={id ? `/objects/${id}` : "/objects"} />
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Only show "not found" if object doesn't exist AND there's no history
  if (!object && !hasHistory && !objectLoading && !historyLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <SmartBackButton defaultPath="/objects" />
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Object not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <SmartBackButton defaultPath={object ? `/objects/${id}` : "/objects"} />
          <div>
            <h1 className="text-3xl font-bold">Object History</h1>
            <p className="text-muted-foreground mt-1">
              {object ? (
                <>
                  Edit history for{" "}
                  <span className="font-medium">{object.name || "Unnamed Object"}</span>
                </>
              ) : (
                <>
                  History for deleted object
                  {id && <span className="font-medium"> ({id})</span>}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {historyError && (
        <Card className="p-4 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
          <p className="text-red-600 dark:text-red-400">
            Error loading history:{" "}
            {historyError instanceof Error
              ? historyError.message
              : "Unknown error"}
          </p>
        </Card>
      )}

      {restoreError && (
        <Card className="p-4 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20">
          <p className="text-red-600 dark:text-red-400">
            Restore failed: {restoreError}
          </p>
        </Card>
      )}

      {historyLoading && (
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading history...</p>
        </div>
      )}

      {!historyLoading && !historyError && (
        <>
          {!history || history.length === 0 ? (
            <Card className="p-8 text-center">
              <History className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                No history available for this object.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {groupedHistory.map((item) => {
                if (Array.isArray(item)) {
                  // Grouped entries
                  const groupId = item.map(e => e._id).join("-");

                  return (
                    <GroupedHistoryCard
                      key={groupId}
                      group={item}
                      onRestore={object ? handleRestore : undefined}
                      isRestoring={restoringKey === groupId}
                      restoreKey={groupId}
                      canRestore={!!object && !updateObject.isPending}
                    />
                  );
                } else {
                  // Single entry
                  return (
                    <HistoryEntryCard
                      key={item._id}
                      entry={item}
                      onRestore={object ? () => handleRestore([
                        { field: item.field!, value: item.oldValue ?? null },
                      ], item._id) : undefined}
                      isRestoring={restoringKey === item._id}
                      canRestore={!!object && !updateObject.isPending}
                    />
                  );
                }
              })}
              {history.length >= 50 && (
                <div className="text-sm text-muted-foreground text-center">
                  Showing first 50 entries. More history may be available.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ObjectHistoryPage;

