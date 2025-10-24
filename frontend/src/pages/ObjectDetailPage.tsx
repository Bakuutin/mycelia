import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { ArrowLeft, Trash2, Plus, X } from 'lucide-react';
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

        <div className="flex gap-6">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isEvent"
              checked={object.isEvent || false}
              onCheckedChange={(checked) => autoSave({ isEvent: checked as boolean })}
            />
            <Label htmlFor="isEvent" className="text-sm font-medium cursor-pointer">
              Is Event
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="isPerson"
              checked={object.isPerson || false}
              onCheckedChange={(checked) => autoSave({ isPerson: checked as boolean })}
            />
            <Label htmlFor="isPerson" className="text-sm font-medium cursor-pointer">
              Is Person
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Aliases</Label>
          <div className="space-y-2">
            {(object.aliases || []).map((alias, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={alias}
                  onChange={(e) => {
                    const newAliases = [...(object.aliases || [])];
                    newAliases[index] = e.target.value;
                    autoSave({ aliases: newAliases });
                  }}
                  placeholder="Alias"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newAliases = (object.aliases || []).filter((_, i) => i !== index);
                    autoSave({ aliases: newAliases.length > 0 ? newAliases : undefined });
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const newAliases = [...(object.aliases || []), ''];
                autoSave({ aliases: newAliases });
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Alias
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Location</Label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="latitude" className="text-xs text-muted-foreground">Latitude</Label>
              <Input
                id="latitude"
                type="number"
                step="any"
                value={object.location?.latitude ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    autoSave({ location: undefined });
                  } else {
                    autoSave({
                      location: {
                        latitude: parseFloat(value),
                        longitude: object.location?.longitude ?? 0,
                      },
                    });
                  }
                }}
                placeholder="0.0"
              />
            </div>
            <div>
              <Label htmlFor="longitude" className="text-xs text-muted-foreground">Longitude</Label>
              <Input
                id="longitude"
                type="number"
                step="any"
                value={object.location?.longitude ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    autoSave({ location: undefined });
                  } else {
                    autoSave({
                      location: {
                        latitude: object.location?.latitude ?? 0,
                        longitude: parseFloat(value),
                      },
                    });
                  }
                }}
                placeholder="0.0"
              />
            </div>
          </div>
          {object.location && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => autoSave({ location: undefined })}
            >
              Clear Location
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Time Ranges</Label>
          <div className="space-y-3">
            {(object.timeRanges || []).map((range, index) => (
              <div key={index} className="border rounded-md p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <Label className="text-xs text-muted-foreground">Range {index + 1}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const newRanges = (object.timeRanges || []).filter((_, i) => i !== index);
                      autoSave({ timeRanges: newRanges.length > 0 ? newRanges : undefined });
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                
                <div>
                  <Label htmlFor={`range-name-${index}`} className="text-xs">Name (optional)</Label>
                  <Input
                    id={`range-name-${index}`}
                    value={range.name || ''}
                    onChange={(e) => {
                      const newRanges = [...(object.timeRanges || [])];
                      newRanges[index] = { ...range, name: e.target.value || undefined };
                      autoSave({ timeRanges: newRanges });
                    }}
                    placeholder="Range name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`range-start-${index}`} className="text-xs">Start</Label>
                    <DateTimePicker
                      value={range.start}
                      onChange={(date) => {
                        const newRanges = [...(object.timeRanges || [])];
                        newRanges[index] = { ...range, start: date };
                        autoSave({ timeRanges: newRanges });
                      }}
                      placeholder="Pick start time"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`range-end-${index}`} className="text-xs">End (optional)</Label>
                    <DateTimePicker
                      nullable
                      value={range.end}
                      onChange={(date) => {
                        const newRanges = [...(object.timeRanges || [])];
                        newRanges[index] = { ...range, end: date };
                        autoSave({ timeRanges: newRanges });
                      }}
                      placeholder="Pick end time (optional)"
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const newRanges = [
                  ...(object.timeRanges || []),
                  { start: new Date(), end: undefined, name: undefined },
                ];
                autoSave({ timeRanges: newRanges });
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Time Range
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ObjectDetailPage;

