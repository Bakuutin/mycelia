import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { APObject } from "@/types/activitypub";
import { ObjectView } from "@/components/activitypub/ObjectView";
import { SimpleObjectEditor } from "@/components/activitypub/SimpleObjectEditor";
import { EdgesEditor } from "@/components/activitypub/EdgesEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Trash2, Save, X, Code, Eye } from "lucide-react";
import { ObjectId, EJSON } from "bson";

const ObjectDetailPage = () => {
  const params = useParams<{ id: string }>();
  const id = new ObjectId(params.id as string);
  const navigate = useNavigate();
  const [object, setObject] = useState<APObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  
  useEffect(() => {
    if (id) {
      fetchObject();
    }
  }, [id.toHexString()]);
  
  const fetchObject = async () => {
    try {
      setLoading(true);
      const result = await callResource("tech.mycelia.mongo", {
        action: "findOne",
        collection: "objects",
        query: { _id: id },
      });
      setObject(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch object");
    } finally {
      setLoading(false);
    }
  };
  
  const handleSave = async () => {
    if (!object) return;
    
    try {
      setSaving(true);
      
      // Get the original object to compare what fields were removed
      const originalResult = await callResource("tech.mycelia.mongo", {
        action: "findOne",
        collection: "objects",
        query: { id: object.id },
      });
      
      if (originalResult) {
        // Find fields that were in the original but not in the updated object
        const fieldsToUnset: string[] = [];
        for (const key in originalResult) {
          if (!(key in object) && !key.startsWith('_') && key !== '@context' && key !== 'id' && key !== 'type') {
            fieldsToUnset.push(key);
          }
        }
        
        // Prepare update operations
        const updateOps: any = { $set: object };
        if (fieldsToUnset.length > 0) {
          const unsetFields: any = {};
          fieldsToUnset.forEach(field => {
            unsetFields[field] = "";
          });
          updateOps.$unset = unsetFields;
        }
        
        await callResource("tech.mycelia.mongo", {
          action: "updateOne",
          collection: "objects",
          query: { id: object.id },
          update: updateOps,
        });
      } else {
        // Fallback to simple $set if we can't get original
        await callResource("tech.mycelia.mongo", {
          action: "updateOne",
          collection: "objects",
          query: { id: object.id },
          update: { $set: object },
        });
      }
      
      fetchObject();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save object");
    } finally {
      setSaving(false);
    }
  };
  
  const handleDelete = async () => {
    if (!object) return;
    
    if (!confirm(`Are you sure you want to delete this object? This action cannot be undone.`)) {
      return;
    }
    
    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "objects",
        query: { id: object.id },
      });
      navigate("/objects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete object");
    }
  };
  
  if (loading) {
    return (
      <div className="space-y-6">
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
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/objects">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error || "Object not found"}</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/objects">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Objects
          </Button>
        </Link>
        
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? (
              <>
                <Eye className="w-4 h-4 mr-2" />
                View
              </>
            ) : (
              <>
                <Code className="w-4 h-4 mr-2" />
                Raw
              </>
            )}
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>
      
      {showRaw ? (
        <Card className="p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Raw Object (EJSON)</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const ejsonString = JSON.stringify(EJSON.serialize(object), null, 2);
                  navigator.clipboard.writeText(ejsonString);
                }}
              >
                Copy EJSON
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-md overflow-auto text-sm font-mono max-h-96">
              {JSON.stringify(EJSON.serialize(object), null, 2)}
            </pre>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          <SimpleObjectEditor
            object={object}
            onChange={setObject}
          />
          <ObjectView object={object} showMetadata />
        </div>
      )}
      
      {object._id && <EdgesEditor objectId={object._id} />}
    </div>
  );
};

export default ObjectDetailPage;

