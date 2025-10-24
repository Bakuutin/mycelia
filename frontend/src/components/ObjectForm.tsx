import { useState } from 'react';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Plus, X } from 'lucide-react';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { ObjectId } from 'bson';

interface ObjectFormProps {
  object: Object;
  onUpdate: (updates: Partial<Object>) => Promise<void>;
  allObjects: Object[];
}

const renderIcon = (icon: any) => {
  if (!icon) return '';
  if (typeof icon === 'string') return icon;
  if (icon.text) return icon.text;
  if (icon.base64) return '📷'; // Placeholder for base64 images
  return '';
};

export function ObjectForm({ object, onUpdate, allObjects }: ObjectFormProps) {
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
                // Create a temporary relationship that will be configured
                const tempObjectId = new ObjectId();
                const tempSubjectId = new ObjectId();
                onUpdate({ 
                  isRelationship: true,
                  relationship: {
                    object: tempObjectId,
                    subject: tempSubjectId,
                    symmetrical: false
                  }
                });
              } else {
                onUpdate({ 
                  isRelationship: false,
                  relationship: undefined
                });
              }
            }}
          />
          <Label htmlFor="isRelationship" className="text-sm font-medium cursor-pointer">
            Is Relationship
          </Label>
        </div>
      </div>

      {object.isRelationship && object.relationship && (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
          <Label className="text-sm font-medium">Relationship Configuration</Label>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="relationship-subject" className="text-xs">Subject</Label>
              <select
                id="relationship-subject"
                value={object.relationship.subject.toString()}
                onChange={(e) => {
                  if (object.relationship) {
                    const newRelationship = {
                      ...object.relationship,
                      subject: new ObjectId(e.target.value)
                    };
                    onUpdate({ relationship: newRelationship });
                  }
                }}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select subject...</option>
                {allObjects.map(obj => (
                  <option key={obj._id.toString()} value={obj._id.toString()}>
                    {renderIcon(obj.icon)} {obj.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="relationship-object" className="text-xs">Object</Label>
              <select
                id="relationship-object"
                value={object.relationship.object.toString()}
                onChange={(e) => {
                  if (object.relationship) {
                    const newRelationship = {
                      ...object.relationship,
                      object: new ObjectId(e.target.value)
                    };
                    onUpdate({ relationship: newRelationship });
                  }
                }}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select object...</option>
                {allObjects.map(obj => (
                  <option key={obj._id.toString()} value={obj._id.toString()}>
                    {renderIcon(obj.icon)} {obj.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="relationship-symmetrical"
              checked={object.relationship.symmetrical}
              onCheckedChange={(checked) => {
                if (object.relationship) {
                  const newRelationship = {
                    ...object.relationship,
                    symmetrical: checked as boolean
                  };
                  onUpdate({ relationship: newRelationship });
                }
              }}
            />
            <Label htmlFor="relationship-symmetrical" className="text-sm font-medium cursor-pointer">
              Symmetrical relationship
            </Label>
          </div>
        </div>
      )}

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
              value={object.location?.longitude ?? ''}
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
        {object.location && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onUpdate({ location: undefined })}
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
              onUpdate({ timeRanges: newRanges });
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Time Range
          </Button>
        </div>
      </div>
    </div>
  );
}
