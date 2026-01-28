import { Link, useNavigate, useParams } from "react-router-dom";
import type { Object, ObjectFormData } from "@/types/objects";
import { Button } from "@/components/ui/button";
import { History, Trash2 } from "lucide-react";
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
import { ObjectId } from "bson";

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
      {/* Header */}
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

      {/* Audio Player - Full width at top when available */}
      {hasTimeRanges && (
        <ObjectAudioPlayer timeRange={object.timeRanges[0]} />
      )}

      {/* Summary + Transcript side by side */}
      {hasTimeRanges && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Summary Panel */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Summary</h3>
            {hasSummary ? (
              <div className="prose prose-sm max-w-none max-h-[400px] overflow-y-auto">
                <div className="whitespace-pre-wrap text-sm">
                  {object.summaries[0].text}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No summary available</p>
            )}
          </div>

          {/* Transcript Panel */}
          <ObjectTranscriptPanel timeRange={object.timeRanges[0]} />
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
          />
        </div>

        {/* Side panel - Metadata & Relationships */}
        <div className="space-y-4">
          <MetadataDisplay object={object} />
          <div className="border rounded-lg p-4">
            <RelationshipsPanel object={object} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ObjectDetailPage;
