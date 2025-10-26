import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowLeft, ArrowLeftRight, Plus, X, MoveHorizontal, RefreshCcw } from 'lucide-react';
import type { Object } from '@/types/objects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmojiPickerButton } from '@/components/ui/emoji-picker';
import { ObjectSelectionDropdown } from '@/components/ObjectSelectionDropdown';
import { getRelationships, useCreateObject } from "@/hooks/useObjectQueries.ts";
import { ObjectId } from 'bson';
import { formatTime, formatTimeRangeDuration } from '@/lib/formatTime';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNow } from '@/hooks/useNow';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface RelationshipsPanelProps {
  object: Object;
}



const renderIcon = (icon: any) => {
  if (!icon) return '';
  if (typeof icon === 'string') return icon;
  if (icon.text) return icon.text;
  if (icon.base64) return '📷'; // Placeholder for base64 images
  return '';
};


export function RelationshipsPanel({ object }: RelationshipsPanelProps) {
  const { data: relationships = [] } = getRelationships(object._id);
  const createObjectMutation = useCreateObject();
  const { timeFormat } = useSettingsStore();
  const now = useNow();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRelationship, setNewRelationship] = useState<{
    name: string;
    icon: { text: string } | { base64: string };
    details: string;
    subjectId: string;
    objectId: string;
    symmetrical: boolean;
  }>({
    name: '',
    icon: { text: '🔗' },
    details: '',
    subjectId: object._id.toString(),
    objectId: '',
    symmetrical: false,
  });
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateRelationship = async () => {
    if (!newRelationship.name.trim()) {
      setCreateError('Relationship name is required');
      return;
    }

    if (!newRelationship.objectId) {
      setCreateError('Please select the object');
      return;
    }

    setCreateError(null);

    const relationshipDoc = {
      name: newRelationship.name.trim(),
      icon: newRelationship.icon,
      details: newRelationship.details || undefined,
      isRelationship: true,
      relationship: {
        subject: new ObjectId(newRelationship.subjectId),
        object: new ObjectId(newRelationship.objectId),
        symmetrical: newRelationship.symmetrical,
      },
    };

    try {
      await createObjectMutation.mutateAsync(relationshipDoc);
      setShowCreateForm(false);
      setNewRelationship({
        name: '',
        icon: { text: '🔗' },
        details: '',
        subjectId: object._id.toString(),
        objectId: '',
        symmetrical: false,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create relationship');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Relationships</h3>
        {!showCreateForm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateForm(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Relationship
          </Button>
        )}
      </div>

      {showCreateForm && (
        <div className="border rounded-lg p-4 space-y-4 bg-muted/50">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">New Relationship</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-start gap-3">
            <div>
              <Label className="text-xs">Icon</Label>
              <div className="mt-1">
                <EmojiPickerButton
                  value={newRelationship.icon}
                  onChange={(icon) => {
                    if (icon) {
                      setNewRelationship(prev => ({ ...prev, icon }));
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex-1">
              <Label htmlFor="rel-name" className="text-xs">Relationship Name</Label>
              <Input
                id="rel-name"
                value={newRelationship.name}
                onChange={(e) => setNewRelationship(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., knows, works with, manages"
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-end">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label className="text-xs">Subject</Label>
                {!newRelationship.symmetrical && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1"
                        onClick={() => {
                          setNewRelationship(prev => ({
                            ...prev,
                            subjectId: prev.objectId || object._id.toString(),
                            objectId: prev.subjectId,
                          }));
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
              <ObjectSelectionDropdown
                value={newRelationship.subjectId}
                onChange={(value) => {
                  if (value) {
                    setNewRelationship(prev => ({
                      ...prev,
                      subjectId: value
                    }));
                  }
                }}
                placeholder="Select a subject..."
              />
            </div>

            <div className="flex items-center justify-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setNewRelationship(prev => ({
                        ...prev,
                        symmetrical: !prev.symmetrical
                      }));
                    }}
                    className="h-[40px] w-[40px] p-0"
                  >
                    {newRelationship.symmetrical ? (
                      <MoveHorizontal className="w-4 h-4" />
                    ) : (
                      <ArrowRight className="w-4 h-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{newRelationship.symmetrical ? 'Make Directional' : 'Make Symmetrical'}</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Object</Label>
              <ObjectSelectionDropdown
                value={newRelationship.objectId}
                onChange={(value) => {
                  if (value) {
                    setNewRelationship(prev => ({
                      ...prev,
                      objectId: value
                    }));
                  }
                }}
                placeholder="Select an object..."
              />
            </div>
          </div>

          <div>
            <Label htmlFor="rel-details" className="text-xs">Details (optional)</Label>
            <textarea
              id="rel-details"
              value={newRelationship.details}
              onChange={(e) => setNewRelationship(prev => ({ ...prev, details: e.target.value }))}
              placeholder="Additional details about this relationship"
              className="mt-1 flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {createError && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {createError}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleCreateRelationship}
              disabled={createObjectMutation.isPending}
            >
              {createObjectMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
              disabled={createObjectMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!object.isRelationship && relationships.length > 0 && (
        <div className="space-y-2">
          <div className="grid gap-2">
            {relationships.map(({ other, relationship }) => {
              // Determine if current object is subject or object in the relationship
              const isCurrentObjectSubject = relationship.relationship?.subject.toString() === object._id.toString();
              const isSymmetrical = relationship.relationship?.symmetrical;

              // Use double-sided arrow for symmetrical relationships, directional arrows for asymmetrical
              const ArrowComponent = isSymmetrical ? ArrowLeftRight : (isCurrentObjectSubject ? ArrowRight : ArrowLeft);

              return (
                <div key={relationship._id.toString()} className="p-1 space-y-2">
                  {/* Horizontal relationship flow */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Link to={`/objects/${relationship._id.toString()}`} className="flex items-center gap-2 min-w-0">
                         
                          <span className="text-lg">{renderIcon(relationship.icon)}</span>
                          <span className="font-medium truncate">{relationship.name}</span>

                        <ArrowComponent className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      </Link>
                      <Link to={`/objects/${other._id.toString()}`} className="flex items-center gap-2 min-w-0">
                        <span className="text-lg">{renderIcon(other.icon)}</span>
                        <span className="font-medium truncate">{other.name}</span>
                      </Link>
                    </div>
                  </div>

                  {/* Relationship description and time ranges below */}
                  {(relationship.details || (relationship.timeRanges && relationship.timeRanges.length > 0)) && (
                    <div className="text-sm text-muted-foreground pl-2 space-y-1">
                      {relationship.details && (
                        <div>{relationship.details}</div>
                      )}
                      {relationship.timeRanges && relationship.timeRanges.length > 0 && (
                        <div className="space-y-1">
                          {relationship.timeRanges.map((range, rangeIndex) => (
                            <div key={rangeIndex} className="text-xs">
                              {range.name && (
                                <span className="font-medium">{range.name}: </span>
                              )}
                              <span>
                                {formatTime(range.start, timeFormat)}
                                {range.end ? (
                                  <> → {formatTime(range.end, timeFormat)}</>
                                ) : (
                                  <span className="ml-2 text-muted-foreground/70">
                                    (ongoing - {formatTimeRangeDuration(range.start, now)})
                                  </span>
                                )}
                                {range.end && (
                                  <span className="ml-2 text-muted-foreground/70">
                                    ({formatTimeRangeDuration(range.start, range.end)})
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!object.isRelationship && relationships.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No related objects found.</p>
          <p className="text-sm mt-1">Create relationship objects to link this object to others.</p>
        </div>
      )}
    </div>
  );
}
