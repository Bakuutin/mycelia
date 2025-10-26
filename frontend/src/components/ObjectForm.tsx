import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Object, ObjectFormData } from '@/types/objects';
import { zObject } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Plus, X, Trash2, RefreshCcw, ArrowRight, MoveHorizontal, ExternalLink } from 'lucide-react';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { ObjectId } from 'bson';
import { ObjectSelectionDropdown } from '@/components/ObjectSelectionDropdown';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { isTimeRangeShorterThanTranscriptThreshold } from '@/lib/transcriptUtils';

interface ObjectFormProps {
  object: ObjectFormData;
  onUpdate: (updates: Partial<ObjectFormData>) => Promise<void>;
}

const renderIcon = (icon: any) => {
  if (!icon) return '';
  if (typeof icon === 'string') return icon;
  if (icon.text) return icon.text;
  if (icon.base64) return '📷'; // Placeholder for base64 images
  return '';
};

// Extract known fields from the Zod schema
const KNOWN_FIELDS = new Set(
  Object.keys((zObject as any)._def.schema.shape)
);

const getTypeString = (value: any): string => {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array';
    const firstType = getTypeString(value[0]);
    return `${firstType}[]`;
  }
  return 'unknown';
};

const formatValue = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value.toString();
  if (Array.isArray(value)) {
    return value.map(v => String(v)).join(', ');
  }
  return String(value);
};

export function ObjectForm({ object, onUpdate }: ObjectFormProps) {
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [newFieldType, setNewFieldType] = useState<'string' | 'number' | 'boolean'>('string');
  const [showAddField, setShowAddField] = useState(false);


  const extraFields = Object.entries(object).filter(
    ([key]) => !KNOWN_FIELDS.has(key)
  );

  const handleAddCustomField = () => {
    if (!newFieldName.trim()) return;

    let value: string | number | boolean;
    if (newFieldType === 'number') {
      value = parseFloat(newFieldValue) || 0;
    } else if (newFieldType === 'boolean') {
      value = newFieldValue.toLowerCase() === 'true';
    } else {
      value = newFieldValue;
    }

    const updates: any = { [newFieldName]: value };
    onUpdate(updates);

    setNewFieldName('');
    setNewFieldValue('');
    setNewFieldType('string');
    setShowAddField(false);
  };

  const handleDeleteCustomField = (fieldName: string) => {
    const updates: any = { $unset: { [fieldName]: '' } };
    onUpdate(updates);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <Label className="text-sm font-medium">Icon</Label>
          <div className="mt-1">
            <EmojiPickerButton
              value={object.icon}
              onChange={(icon) => onUpdate({ icon })}
            />
          </div>
        </div>

        <div className="flex-1">
          <Label htmlFor="name" className="text-sm font-medium">Name</Label>
          <Input
            id="name"
            value={object.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
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
          onChange={(e) => onUpdate({ details: e.target.value || undefined })}
          placeholder="Optional details about this object"
          className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="flex gap-6">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="isEvent"
            checked={object.isEvent || false}
            onCheckedChange={(checked) => onUpdate({ isEvent: checked as boolean })}
          />
          <Label htmlFor="isEvent" className="text-sm font-medium cursor-pointer">
            Is Event
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="isPerson"
            checked={object.isPerson || false}
            onCheckedChange={(checked) => onUpdate({ isPerson: checked as boolean })}
          />
          <Label htmlFor="isPerson" className="text-sm font-medium cursor-pointer">
            Is Person
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="isRelationship"
            checked={object.isRelationship || false}
            onCheckedChange={(checked) => {
              if (checked) {
                onUpdate({
                  isRelationship: true,
                  relationship: {
                    symmetrical: false
                  }
                });
              } else {
                onUpdate({
                  isRelationship: false,
                  relationship: undefined,
                  isPromise: false // Clear isPromise if relationship is removed
                });
              }
            }}
          />
          <Label htmlFor="isRelationship" className="text-sm font-medium cursor-pointer">
            Is Relationship
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="isPromise"
            checked={object.isPromise || false}
            onCheckedChange={(checked) => {
              if (checked) {
                // If isPromise is true, ensure it's a relationship
                const updates: Partial<ObjectFormData> = { isPromise: true };

                // Ensure it's a relationship
                if (!object.isRelationship) {
                  updates.isRelationship = true;
                  updates.relationship = {
                    symmetrical: false
                  };
                }

                onUpdate(updates);
              } else {
                onUpdate({ isPromise: false });
              }
            }}
          />
          <Label htmlFor="isPromise" className="text-sm font-medium cursor-pointer">
            Is Promise
          </Label>

        </div>
      </div>

      {object.isRelationship && object.relationship && (
        <div>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-end">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label className="text-xs">Subject</Label>
                {!object.relationship.symmetrical && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1"
                        onClick={() => {
                          if (object.relationship) {
                            const newRelationship = {
                              ...object.relationship,
                              subject: object.relationship.object,
                              object: object.relationship.subject
                            };
                            onUpdate({ relationship: newRelationship });
                          }
                        }}
                      >
                        <RefreshCcw className="w-3 h-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Reverse direction</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="flex gap-2">
                <ObjectSelectionDropdown
                  value={object.relationship.subject instanceof ObjectId ? object.relationship.subject.toHexString() : String(object.relationship.subject)}
                  onChange={(value) => {
                    if (object.relationship && value) {
                      const newRelationship = {
                        ...object.relationship,
                        subject: new ObjectId(value)
                      };
                      onUpdate({ relationship: newRelationship });
                    }
                  }}
                  placeholder="Select a subject..."
                  className="flex-1"
                />
                {object.relationship.subject && (
                  <Link
                    to={`/objects/${object.relationship.subject instanceof ObjectId ? object.relationship.subject.toHexString() : String(object.relationship.subject)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="icon" className="h-9 w-9">
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (object.relationship) {
                        const newRelationship = {
                          ...object.relationship,
                          symmetrical: !object.relationship.symmetrical
                        };
                        onUpdate({ relationship: newRelationship });
                      }
                    }}
                    className="h-[40px] w-[40px] p-0"
                  >
                    {object.relationship.symmetrical ? (
                      <MoveHorizontal className="w-4 h-4" />
                    ) : (
                      <ArrowRight className="w-4 h-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{object.relationship.symmetrical ? 'Make Directional' : 'Make Symmetrical'}</p>
                </TooltipContent>
              </Tooltip>
            </div>


            <div>
              <Label className="text-xs mb-1 block">Object</Label>
              <div className="flex gap-2">
                <ObjectSelectionDropdown
                  value={object.relationship.object instanceof ObjectId ? object.relationship.object.toHexString() : String(object.relationship.object)}
                  onChange={(value) => {
                    if (object.relationship && value) {
                      const newRelationship = {
                        ...object.relationship,
                        object: new ObjectId(value)
                      };
                      onUpdate({ relationship: newRelationship });
                    }
                  }}
                  placeholder="Select an object..."
                  className="flex-1"
                />
                {object.relationship.object && (
                  <Link
                    to={`/objects/${object.relationship.object instanceof ObjectId ? object.relationship.object.toHexString() : String(object.relationship.object)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="icon" className="h-9 w-9">
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>

        </div>
      )}

      <div className="space-y-2">
        {object.aliases && object.aliases.length > 0 && (
          <Label className="text-sm font-medium">Aliases</Label>
        )}
        <div className="space-y-2">
          {(object.aliases || []).map((alias, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={alias}
                onChange={(e) => {
                  const newAliases = [...(object.aliases || [])];
                  newAliases[index] = e.target.value;
                  onUpdate({ aliases: newAliases });
                }}
                placeholder="Alias"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const newAliases = (object.aliases || []).filter((_, i) => i !== index);
                  onUpdate({ aliases: newAliases.length > 0 ? newAliases : undefined });
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {object.location && (
          <Label className="text-sm font-medium">Location</Label>
        )}
        {object.location && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="latitude" className="text-xs text-muted-foreground">Latitude</Label>
                <Input
                  id="latitude"
                  type="number"
                  step="any"
                  value={object.location.latitude}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      onUpdate({ location: undefined });
                    } else {
                      onUpdate({
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
                  value={object.location.longitude}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      onUpdate({ location: undefined });
                    } else {
                      onUpdate({
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUpdate({ location: undefined })}
            >
              Clear Location
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {object.timeRanges && object.timeRanges.length > 0 && (
          <Label className="text-sm font-medium">Time Ranges</Label>
        )}
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
                    onUpdate({ timeRanges: newRanges.length > 0 ? newRanges : undefined });
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
                    onUpdate({ timeRanges: newRanges });
                  }}
                  placeholder="Range name"
                />
              </div>
              <div>
                <Label htmlFor={`range-start-${index}`} className="text-xs">Start</Label>
                <DateTimePicker
                  value={range.start}
                  onChange={(date) => {
                    if (date) {
                      const newRanges = [...(object.timeRanges || [])];
                      newRanges[index] = { ...range, start: date };
                      onUpdate({ timeRanges: newRanges });
                    }
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
                    newRanges[index] = { ...range, end: date || undefined };
                    onUpdate({ timeRanges: newRanges });
                  }}
                  placeholder="Pick end time (optional)"
                />
              </div>

              {/* Transcript button for ranges shorter than user-configured threshold */}
              {range.end && isTimeRangeShorterThanTranscriptThreshold(range.start, range.end) && (
                <div className="pt-2 flex items-center gap-2">
                  <Link to={`/transcript?start=${range.start.getTime()}&end=${range.end.getTime()}`}>
                    <Button variant="outline" size="sm">
                      Go to transcript
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {extraFields.length > 0 && (
          <Label className="text-sm font-medium">Custom Fields</Label>
        )}
        {showAddField && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/50">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-field-name" className="text-xs">Field Name</Label>
                <Input
                  id="new-field-name"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="fieldName"
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="new-field-type" className="text-xs">Type</Label>
                <select
                  id="new-field-type"
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as 'string' | 'number' | 'boolean')}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="new-field-value" className="text-xs">Value</Label>
              {newFieldType === 'boolean' ? (
                <select
                  id="new-field-value"
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <Input
                  id="new-field-value"
                  type={newFieldType === 'number' ? 'number' : 'text'}
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                  placeholder={newFieldType === 'number' ? '0' : 'value'}
                  className="mt-1"
                />
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddCustomField}
                disabled={!newFieldName.trim()}
              >
                Add Field
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddField(false);
                  setNewFieldName('');
                  setNewFieldValue('');
                  setNewFieldType('string');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {extraFields.length > 0 && (
          <div className="border rounded-lg divide-y">
            {extraFields.map(([key, value]) => (
              <div key={key} className="p-3 grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center">
                <div className="font-mono text-sm font-medium">{key}</div>
                <div className="text-sm text-muted-foreground truncate">{formatValue(value)}</div>
                <div className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                  {getTypeString(value)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteCustomField(key)}
                  className="h-8 w-8 p-0"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Buttons Section */}
      <div className="flex flex-wrap gap-2 pt-4 border-t">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const newAliases = [...(object.aliases || []), ''];
            onUpdate({ aliases: newAliases });
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Alias
        </Button>

        {!object.location && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdate({
              location: {
                latitude: 0,
                longitude: 0
              }
            })}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Location
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const newRanges = [
              ...(object.timeRanges || []),
              { start: new Date(), end: undefined, name: undefined },
            ];
            onUpdate({ timeRanges: newRanges });
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Time Range
        </Button>

        {!showAddField && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddField(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Custom Field
          </Button>
        )}
      </div>
    </div>
  );
}
