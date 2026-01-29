import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Object, ObjectFormData } from "@/types/objects";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { 
  History, 
  Trash2, 
  Pencil, 
  Check, 
  X, 
  Tag, 
  Handshake,
  Users,
  MessageSquare,
  User,
  Calendar,
  Package,
  Save,
  Clock,
} from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { SmartBackButton } from "@/components/SmartBackButton";
import {
  useDeleteObject,
  useObject,
  useUpdateObject,
} from "@/hooks/useObjectQueries";
import { ObjectForm } from "@/components/ObjectForm";
import { RelationshipsPanel } from "@/components/RelationshipsPanel";
import { MetadataDisplay } from "@/components/MetadataDisplay";
import { ObjectPlayerTranscript } from "@/components/ObjectPlayerTranscript";
import { TimeRangeEditDialog } from "@/components/TimeRangeEditDialog";
import { Markdown } from "@/components/Markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatTime } from "@/lib/formatTime";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmojiPickerButton } from "@/components/ui/emoji-picker";

// Helper to format relative time (e.g., "2 minutes ago")
function formatRelativeTime(date: Date | string | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

// Helper to get object type info
function getObjectType(object: { isPromise?: boolean; isRelationship?: boolean; isConversation?: boolean; isPerson?: boolean; isEvent?: boolean }): {
  type: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
} {
  if (object.isPromise) return { type: "Promise", icon: Handshake, color: "bg-orange-100 text-orange-800 border border-orange-200" };
  if (object.isRelationship) return { type: "Relationship", icon: Users, color: "bg-purple-100 text-purple-800 border border-purple-200" };
  if (object.isConversation) return { type: "Conversation", icon: MessageSquare, color: "bg-cyan-100 text-cyan-800 border border-cyan-200" };
  if (object.isPerson) return { type: "Person", icon: User, color: "bg-blue-100 text-blue-800 border border-blue-200" };
  if (object.isEvent) return { type: "Event", icon: Calendar, color: "bg-green-100 text-green-800 border border-green-200" };
  return { type: "Object", icon: Package, color: "bg-gray-100 text-gray-800 border border-gray-200" };
}

// Inline editable title component
function EditableTitle({
  icon,
  name,
  onIconChange,
  onNameChange,
}: {
  icon: any;
  name: string;
  onIconChange: (icon: any) => void;
  onNameChange: (name: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditName(name);
  }, [name]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editName.trim() !== name) {
      onNameChange(editName.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(name);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <div className="flex items-center gap-3 group flex-1 min-w-0">
      <EmojiPickerButton
        value={icon}
        onChange={onIconChange}
        className="text-4xl flex-shrink-0"
      />
      {isEditing ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            className="text-2xl font-bold h-auto py-1 flex-1"
          />
          <Button variant="ghost" size="sm" onClick={handleSave} className="flex-shrink-0">
            <Check className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel} className="flex-shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <h1 
          className="text-2xl font-bold cursor-pointer hover:text-primary transition-colors flex items-center gap-2 flex-1 min-w-0"
          onClick={() => setIsEditing(true)}
        >
          <span className="truncate">{name || "Untitled Object"}</span>
          <Pencil className="w-4 h-4 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
        </h1>
      )}
    </div>
  );
}

const ObjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Use React Query hooks
  const { data: object, isLoading: loading, error } = useObject(id);
  const updateObjectMutation = useUpdateObject();
  const deleteObjectMutation = useDeleteObject();
  
  // State for time range editing from metadata display
  const [editingTimeRangeIndex, setEditingTimeRangeIndex] = useState<number | null>(null);
  
  // State for summary details dialog
  const [selectedSummary, setSelectedSummary] = useState<any | null>(null);
  
  // State for editing details
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editingDetailsValue, setEditingDetailsValue] = useState("");
  
  // Autosave settings and status
  const { autoSave, setAutoSave } = useSettingsStore();
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [, forceUpdate] = useState(0); // For relative time updates
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Update relative time every minute
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // Throttled save function - saves after 2 seconds of inactivity
  const throttledSave = useCallback((field: string, value: any) => {
    if (!object || !id) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for 2 seconds
    saveTimeoutRef.current = setTimeout(() => {
      updateObjectMutation.mutate({
        id: object._id.toString(),
        version: object.version,
        field,
        value,
      }, {
        onSuccess: () => setLastSaved(new Date()),
      });
    }, 2000);
  }, [object, id, updateObjectMutation]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleFieldUpdate = useCallback((field: string, value: any) => {
    if (!object || !id) return;

    if (autoSave) {
      // Use throttled save with 2 second delay
      throttledSave(field, value);
    } else {
      // Accumulate changes when autosave is off
      setPendingChanges(prev => ({ ...prev, [field]: value }));
    }
  }, [object, id, autoSave, throttledSave]);

  // Manual save function
  const handleManualSave = useCallback(() => {
    if (!object || !id || Object.keys(pendingChanges).length === 0) return;

    // Save all pending changes
    for (const [field, value] of Object.entries(pendingChanges)) {
      updateObjectMutation.mutate({
        id: object._id.toString(),
        version: object.version,
        field,
        value,
      });
    }
    setPendingChanges({});
    setLastSaved(new Date());
  }, [object, id, pendingChanges, updateObjectMutation]);

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  // Convert Object to ObjectFormData for the form
  const formObject: ObjectFormData = object
    ? {
      ...object,
      relationship: object.relationship
        ? {
          object: object.relationship.object,
          subject: object.relationship.subject,
          symmetrical: object.relationship.symmetrical,
        }
        : undefined,
    }
    : {} as ObjectFormData;

  const handleDelete = async () => {
    if (!object || !id) return;
    const confirmed = globalThis.confirm
      ? globalThis.confirm("Delete this object?")
      : true;
    if (!confirmed) return;

    deleteObjectMutation.mutate(id, {
      onSuccess: () => {
        navigate("/objects");
      },
    });
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <SmartBackButton defaultPath="/objects" />
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading object...</p>
        </div>
      </div>
    );
  }

  if (error || !object) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <SmartBackButton defaultPath="/objects" />
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">
            Error: {error?.message || "Object not found"}
          </p>
        </div>
      </div>
    );
  }

  const hasTimeRanges = object.timeRanges && object.timeRanges.length > 0;
  const hasSummary = object.summaries && object.summaries.length > 0;
  
  // Get object type info for badge
  const typeInfo = getObjectType(object);
  const TypeIcon = typeInfo.icon;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header with navigation and actions */}
      <div className="flex items-center justify-between">
        <SmartBackButton defaultPath="/objects" />
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {updateObjectMutation.isPending ? (
              <span className="text-primary">Saving...</span>
            ) : hasPendingChanges ? (
              <span className="text-amber-600">Unsaved</span>
            ) : (
              <span className="flex items-center gap-1 text-green-600">
                <Check className="w-3 h-3" />
                Saved
              </span>
            )}
          </div>
          
          {/* Autosave toggle */}
          <div className="flex items-center gap-1 text-xs">
            <Switch
              checked={autoSave}
              onCheckedChange={setAutoSave}
              className="h-4 w-7"
            />
            <span className="text-muted-foreground">Auto</span>
          </div>
          
          {/* Save button (shown when autosave is off) */}
          {!autoSave && (
            <Button 
              variant={hasPendingChanges ? "default" : "outline"}
              size="sm" 
              onClick={handleManualSave}
              disabled={!hasPendingChanges || updateObjectMutation.isPending}
            >
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          )}
          
          <Button variant="outline" size="sm" asChild>
            <Link to={`/objects/${id}/history`}>
              <History className="w-4 h-4 mr-1" />
              History
              <span className="ml-1 text-muted-foreground">v{object.version}</span>
            </Link>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteObjectMutation.isPending}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Title row: Icon + Name on left, metadata on right - all on one line */}
      <div className="flex items-center justify-between gap-4">
        <EditableTitle
          icon={object.icon}
          name={object.name || ""}
          onIconChange={(icon) => handleFieldUpdate("icon", icon)}
          onNameChange={(name) => handleFieldUpdate("name", name)}
        />
        
        {/* Object Type, Date, Duration, Tags - aligned on one line */}
        <div className="flex items-center gap-3 flex-shrink-0 text-xs">
          {/* Object Type Badge */}
          <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium ${typeInfo.color}`}>
            <TypeIcon className="w-3 h-3" />
            <span>{typeInfo.type}</span>
          </div>
          
          {/* Date and Duration together */}
          {hasTimeRanges && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{formatTime(new Date(object.timeRanges[0].start), "gregorian-local-natural")}</span>
              {object.timeRanges[0].end && (
                <span className="font-semibold text-foreground">
                  {Math.round((new Date(object.timeRanges[0].end).getTime() - new Date(object.timeRanges[0].start).getTime()) / 60000)}m
                </span>
              )}
            </div>
          )}
          
          {/* Aliases as tags */}
          {object.aliases && object.aliases.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="w-3 h-3 text-muted-foreground" />
              {object.aliases.slice(0, 2).map((alias, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs py-0">
                  {alias}
                </Badge>
              ))}
              {object.aliases.length > 2 && (
                <span className="text-muted-foreground">+{object.aliases.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Row 1: Summary (left) + Player/Transcript (right) - flexible height */}
      {hasTimeRanges && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Summary - flexible height, expands for long content */}
          <div className="border rounded-lg p-4 bg-muted/30 min-h-[400px] max-h-[800px] flex flex-col">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex-shrink-0">Summary</h3>
            {hasSummary ? (
              <>
                <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]]:!overflow-y-scroll">
                  <div className="prose prose-sm max-w-none pr-3">
                    <Markdown>{object.summaries[0].text}</Markdown>
                  </div>
                </ScrollArea>
                {/* Summary metadata */}
                <div className="flex-shrink-0 pt-3 mt-3 border-t flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {object.summaries[0].model && (
                    <span className="flex items-center gap-1">
                      <span className="font-medium">Model:</span>
                      <span>{object.summaries[0].modelName || object.summaries[0].model}</span>
                    </span>
                  )}
                  {object.summaries[0].date && (
                    <span className="flex items-center gap-1">
                      <span className="font-medium">Generated:</span>
                      <span>{formatRelativeTime(object.summaries[0].date)}</span>
                    </span>
                  )}
                  {(object.summaries[0].usage || object.summaries[0].prompt || object.summaries[0].jobId) && (
                    <Button 
                      variant="link" 
                      size="sm"
                      onClick={() => setSelectedSummary(object.summaries[0])}
                      className="p-0 h-auto text-xs"
                    >
                      More details...
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No summary available</p>
            )}
          </div>

          {/* Player + Transcript - flexible height, expands for long content */}
          <ObjectPlayerTranscript timeRange={object.timeRanges[0]} minHeight={400} maxHeight={800} />
        </div>
      )}

      {/* Row 2: Relationships + Time Info + Metadata (side by side) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Relationships - compact */}
        <div className="border rounded-lg p-3 min-h-[180px] max-h-[300px] overflow-y-auto">
          <RelationshipsPanel object={object} compact />
        </div>

        {/* Time Information - compact */}
        <MetadataDisplay 
          object={object} 
          hideObjectType 
          compact
          onEditTimeRanges={hasTimeRanges ? () => setEditingTimeRangeIndex(0) : undefined}
        />

        {/* Object Form - compact mode */}
        <div className="border rounded-lg p-3">
          <ObjectForm
            object={formObject}
            onUpdate={async (updates) => {
              if (!object) return;
              for (const [field, value] of Object.entries(updates)) {
                handleFieldUpdate(field, value);
              }
            }}
            hideSummary
            hideIconName
            hideDetails
            compact
          />
        </div>
      </div>

      {/* Row 3: Details - full width */}
      <div className="border rounded-lg p-4 bg-muted/30 min-h-[150px] max-h-[300px] flex flex-col">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-muted-foreground">Details</h3>
          <div className="flex items-center gap-1">
            <Button
              variant={isEditingDetails ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                if (!isEditingDetails) {
                  setEditingDetailsValue(object.details || "");
                }
                setIsEditingDetails(!isEditingDetails);
              }}
            >
              {isEditingDetails ? "Preview" : "Edit"}
            </Button>
            {isEditingDetails && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  handleFieldUpdate("details", editingDetailsValue);
                  setIsEditingDetails(false);
                }}
              >
                <Check className="w-3 h-3 mr-1" />
                Save
              </Button>
            )}
          </div>
        </div>
        {isEditingDetails ? (
          <Textarea
            value={editingDetailsValue}
            onChange={(e) => setEditingDetailsValue(e.target.value)}
            placeholder="Add details about this object..."
            className="flex-1 min-h-[100px] resize-none font-mono text-sm"
          />
        ) : (
          <ScrollArea className="flex-1 [&>[data-radix-scroll-area-viewport]]:!overflow-y-scroll">
            <div className="prose prose-sm max-w-none pr-3">
              {object.details ? (
                <Markdown>{object.details}</Markdown>
              ) : (
                <p className="text-muted-foreground text-sm">No details available. Click Edit to add.</p>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Time Range Edit Dialog triggered from MetadataDisplay */}
      {editingTimeRangeIndex !== null && object.timeRanges && object.timeRanges[editingTimeRangeIndex] && (
        <TimeRangeEditDialog
          open={editingTimeRangeIndex !== null}
          onOpenChange={(open) => !open && setEditingTimeRangeIndex(null)}
          timeRange={object.timeRanges[editingTimeRangeIndex]}
          index={editingTimeRangeIndex}
          onSave={(index, range) => {
            const newRanges = [...(object.timeRanges || [])];
            newRanges[index] = range;
            handleFieldUpdate("timeRanges", newRanges);
          }}
          onDelete={(index) => {
            const newRanges = (object.timeRanges || []).filter((_, i) => i !== index);
            handleFieldUpdate("timeRanges", newRanges.length > 0 ? newRanges : undefined);
          }}
        />
      )}

      {/* Summary Details Dialog */}
      <Dialog open={selectedSummary !== null} onOpenChange={(open) => !open && setSelectedSummary(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Summary Details</DialogTitle>
          </DialogHeader>
          {selectedSummary && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Model</Label>
                  <div className="mt-1 text-sm">
                    {selectedSummary.model} {selectedSummary.modelName && `(${selectedSummary.modelName})`}
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Generated</Label>
                  <div className="mt-1 text-sm">
                    {new Date(selectedSummary.date).toLocaleString([], {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </div>
                </div>
              </div>

              {selectedSummary.usage && (
                <div>
                  <Label className="text-sm font-medium">Token Usage</Label>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                    <div className="p-2 bg-muted rounded">
                      <div className="text-xs text-muted-foreground">Prompt</div>
                      <div className="font-medium">{selectedSummary.usage.promptTokens?.toLocaleString()}</div>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <div className="text-xs text-muted-foreground">Completion</div>
                      <div className="font-medium">{selectedSummary.usage.completionTokens?.toLocaleString()}</div>
                    </div>
                    <div className="p-2 bg-muted rounded">
                      <div className="text-xs text-muted-foreground">Total</div>
                      <div className="font-medium">{selectedSummary.usage.totalTokens?.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              )}

              {selectedSummary.prompt && (
                <div>
                  <Label className="text-sm font-medium">System Prompt</Label>
                  <div className="mt-2 p-3 bg-muted rounded-md text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto font-mono">
                    {selectedSummary.prompt}
                  </div>
                </div>
              )}

              {selectedSummary.jobId && (
                <div>
                  <Label className="text-sm font-medium">Job ID</Label>
                  <div className="mt-1 text-sm font-mono text-muted-foreground">
                    {selectedSummary.jobId}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ObjectDetailPage;
