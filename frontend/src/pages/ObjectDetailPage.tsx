import { Link, useNavigate, useParams } from "react-router-dom";
import type { Object, ObjectFormData } from "@/types/objects";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  useDeleteObject,
  useObject,
  useUpdateObject,
} from "@/hooks/useObjectQueries";
import { ObjectForm } from "@/components/ObjectForm";
import { RelationshipsPanel } from "@/components/RelationshipsPanel";
import { MetadataDisplay } from "@/components/MetadataDisplay";
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
          <Link to="/objects">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
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
          <Link to="/objects">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">
            Error: {error?.message || "Object not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/objects">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {updateObjectMutation.isPending && (
            <span className="text-xs text-muted-foreground">Saving...</span>
          )}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded-lg p-6">
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

        <div className="space-y-6">
          <div className="border rounded-lg p-6">
            <RelationshipsPanel object={object} />
          </div>
          <MetadataDisplay object={object} />
        </div>
      </div>
    </div>
  );
};

export default ObjectDetailPage;
