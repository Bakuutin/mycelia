import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { Object } from '@/types/objects';
import { formatTime } from '@/lib/formatTime';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { X } from 'lucide-react';
import { TimelineChart } from '@/components/timeline/TimelineChart';
import { IconDisplay } from '@/components/IconDisplay';
import { config } from '@/config';
import { useObjects } from '@/modules/objects/useObjects';
import { isTimeRangeShorterThanTranscriptThreshold } from '@/lib/transcriptUtils';

const TimelinePage = () => {
  const { objects, loading, error } = useObjects();
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(new Set());
  const { timeFormat } = useSettingsStore();


  const toggleObjectSelection = (objectId: string) => {
    setSelectedObjectIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(objectId)) {
        newSet.delete(objectId);
      } else {
        newSet.add(objectId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedObjectIds(new Set(objects.map(o => o._id.toString())));
  };

  const clearSelection = () => {
    setSelectedObjectIds(new Set());
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading objects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500 mb-2">Error loading objects: {error}</p>
          <p className="text-sm text-muted-foreground">Check browser console for details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="flex items-center gap-2">
          {config.tools.map((tool, i) => (
            <tool.component key={i} />
          ))}
        </div>
      </div>

      <div className="border rounded-lg p-2">
        <TimelineChart />
      </div>

      {selectedObjectIds.size > 0 && (
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium">
              {selectedObjectIds.size} object{selectedObjectIds.size !== 1 ? 's' : ''} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
            >
              <X className="w-4 h-4 mr-2" />
              Clear Selection
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-lg">
        {objects.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">No objects with time ranges found</p>
          </div>
        ) : (
          <>
            <div className="p-4 border-b bg-muted/20">
              <div className="flex items-center gap-4">
                <Checkbox
                  checked={selectedObjectIds.size === objects.length && objects.length > 0}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      selectAll();
                    } else {
                      clearSelection();
                    }
                  }}
                />
                <span className="text-sm font-medium">
                  {selectedObjectIds.size === objects.length && objects.length > 0
                    ? 'Deselect all'
                    : 'Select all'}
                </span>
              </div>
            </div>
            <div className="divide-y">
              {objects.map((object) => {
                const isSelected = selectedObjectIds.has(object._id.toString());

                return (
                  <div
                    key={object._id.toString()}
                    className={`flex items-start gap-4 p-4 transition-colors ${isSelected ? 'bg-muted/50' : 'hover:bg-muted/30'
                      }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleObjectSelection(object._id.toString())}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="mt-1 flex-shrink-0">
                      <IconDisplay icon={object.icon} fallback="📦" />
                    </div>
                    <Link
                      to={`/objects/${object._id.toString()}`}
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-baseline gap-2">
                        <h3 className="font-medium hover:text-primary transition-colors">
                          {object.name || 'Unnamed object'}
                        </h3>
                      </div>
                      {object.details && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {object.details}
                        </p>
                      )}
                      {object.timeRanges && object.timeRanges.length > 0 && (
                        <div className="space-y-1 mt-2">
                          {object.timeRanges.map((range, idx) => (
                            <div key={idx} className="text-xs text-muted-foreground">
                              <div className="flex items-center justify-between">
                                <span>
                                  {range.name && <span className="font-medium">{range.name}: </span>}
                                  {formatTime(range.start, timeFormat)}
                                  {range.end && (
                                    <> → {formatTime(range.end, timeFormat)}</>
                                  )}
                                </span>
                                {range.end && isTimeRangeShorterThanTranscriptThreshold(range.start, range.end) && (
                                  <Link to={`/transcript?start=${range.start.getTime()}&end=${range.end.getTime()}`}>
                                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
                                      Transcript
                                    </Button>
                                  </Link>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Link>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TimelinePage;
