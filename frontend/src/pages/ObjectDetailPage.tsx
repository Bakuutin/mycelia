import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';

const ObjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [object, setObject] = useState<Object | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    }
  }, [id]);

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
    <div className="max-w-2xl mx-auto space-y-6">
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

      <div className="border rounded-lg p-6 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <Label className="text-sm font-medium">Icon</Label>
            <div className="mt-1">
              <EmojiPickerButton
                value={object.icon}
                onChange={(icon) => autoSave({ icon })}
              />
            </div>
          </div>

          <div className="flex-1">
            <Label htmlFor="name" className="text-sm font-medium">Name</Label>
            <Input
              id="name"
              value={object.name}
              onChange={(e) => autoSave({ name: e.target.value })}
              placeholder="Object name"
              className="mt-1"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="details">Details</Label>
          <textarea
            id="details"
            value={object.details || ""}
            onChange={(e) => autoSave({ details: e.target.value || undefined })}
            placeholder="Optional details about this object"
            className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
    </div>
  );
};

export default ObjectDetailPage;

