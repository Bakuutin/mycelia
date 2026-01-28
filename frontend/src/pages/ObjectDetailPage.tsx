import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Object, ObjectFormData } from "@/types/objects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { History, Trash2, Pencil, Check, X } from "lucide-react";
import { SmartBackButton } from "@/components/SmartBackButton";
import {
  useDeleteObject,
  useObject,
  useUpdateObject,
} from "@/hooks/useObjectQueries";
import { ObjectForm } from "@/components/ObjectForm";
import { RelationshipsPanel } from "@/components/RelationshipsPanel";
import { MetadataDisplay } from "@/components/MetadataDisplay";
import { ObjectAudioPlayer } from "@/components/ObjectAudioPlayer";
import { ObjectTranscriptPanel } from "@/components/ObjectTranscriptPanel";
import { Markdown } from "@/components/Markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmojiPickerButton } from "@/components/ui/emoji-picker";

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
    <div className="flex items-center gap-3 group">
      <EmojiPickerButton
        value={icon}
        onChange={onIconChange}
        className="text-4xl"
      />
      {isEditing ? (
        <div className="flex items-center gap-2 flex-1">
          <Input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            className="text-2xl font-bold h-auto py-1"
          />
          <Button variant="ghost" size="sm" onClick={handleSave}>
            <Check className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <h1 
          className="text-2xl font-bold cursor-pointer hover:text-primary transition-colors flex items-center gap-2"
          onClick={() => setIsEditing(true)}
        >
          {name || "Untitled Object"}
          <Pencil className="w-4 h-4 opacity-0 group-hover:opacity-50 transition-opacity" />
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

  const handleFieldUpdate = (field: string, value: any) => {
    if (!object || !id) return;

    updateObjectMutation.mutate({
      id: object._id.toString(),
      version: object.version,
      field,
      value,
    });
  };

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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header with navigation and actions */}
      <div className="flex items-center justify-between">
        <SmartBackButton defaultPath="/objects" />
        <div className="flex items-center gap-2">
          {updateObjectMutation.isPending && (
            <span className="text-xs text-muted-foreground">Saving...</span>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link to={`/objects/${id}/history`}>
              <History className="w-4 h-4 mr-2" />
              History
            </Link>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteObjectMutation.isPending}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {deleteObjectMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>

      {/* Title: Icon + Name (editable inline) */}
      <EditableTitle
        icon={object.icon}
        name={object.name || ""}
        onIconChange={(icon) => handleFieldUpdate("icon", icon)}
        onNameChange={(name) => handleFieldUpdate("name", name)}
      />

      {/* Main content: Summary on left, Player+Transcript on right */}
      {hasTimeRanges && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Summary */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Summary</h3>
            {hasSummary ? (
              <ScrollArea className="h-[500px]">
                <div className="prose prose-sm max-w-none pr-3">
                  <Markdown>{object.summaries[0].text}</Markdown>
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">No summary available</p>
            )}
          </div>

          {/* Right column: Player on top, Transcript below */}
          <div className="space-y-4">
            <ObjectAudioPlayer timeRange={object.timeRanges[0]} />
            <ObjectTranscriptPanel timeRange={object.timeRanges[0]} />
          </div>
        </div>
      )}

      {/* Object Details Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form - takes 2 columns */}
        <div className="lg:col-span-2 border rounded-lg p-6">
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
          />
        </div>

        {/* Side panel - Metadata & Relationships */}
        <div className="space-y-4">
          <MetadataDisplay object={object} hideObjectType />
          <div className="border rounded-lg p-4">
            <RelationshipsPanel object={object} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ObjectDetailPage;
