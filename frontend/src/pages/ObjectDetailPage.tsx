import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useObjects, useRelatedObjects } from '@/hooks/useObjects';
import { ObjectForm } from '@/components/ObjectForm';
import { RelationshipsPanel } from '@/components/RelationshipsPanel';

const ObjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [object, setObject] = useState<Object | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Use custom hooks for object management
  const { allObjects, fetchAllObjects } = useObjects();
  const { relatedObjects, fetchRelatedObjects } = useRelatedObjects(id);


  useEffect(() => {
    const fetchObject = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "findOne",
          collection: "objects",
          query: { _id: { $oid: id } },
        });
        if (result) {
          setObject(result);
          if (!result.isRelationship) {
            fetchRelatedObjects(id!);
          }
        } else {
          setError("Object not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch object');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchObject();
      fetchAllObjects();
    }
  }, [id, fetchAllObjects, fetchRelatedObjects]);

  const autoSave = async (updates: Partial<Object>) => {
    if (!object) return;

    setSaving(true);
    try {
      await callResource("tech.mycelia.mongo", {
        action: "updateOne",
        collection: "objects",
        query: { _id: object._id },
        update: {
          $set: {
            ...updates,
            updatedAt: new Date(),
          },
        },
      });

      setObject({ ...object, ...updates });
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!object) return;
    const confirmed = globalThis.confirm ? globalThis.confirm("Delete this object?") : true;
    if (!confirmed) return;

    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "objects",
        query: { _id: object._id },
      });
      navigate('/objects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete object');
    }
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
          <p className="text-red-500">Error: {error || 'Object not found'}</p>
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
          {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Object Details */}
        <div className="border rounded-lg p-6">
          <ObjectForm 
            object={object} 
            onUpdate={autoSave} 
            allObjects={allObjects} 
          />
        </div>

        {/* Right Column - Relationships */}
        <div className="border rounded-lg p-6">
          <RelationshipsPanel 
            object={object} 
            allObjects={allObjects} 
            relatedObjects={relatedObjects} 
          />
        </div>
      </div>
    </div>
  );
};

export default ObjectDetailPage;

