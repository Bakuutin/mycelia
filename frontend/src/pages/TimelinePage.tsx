import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { callResource } from '@/lib/api';
import type { EventItem } from '@/types/events';
import { formatTime } from '@/lib/formatTime';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { PlusIcon, X } from 'lucide-react';
import { TimelineChart } from '@/components/timeline/TimelineChart';

const TimelinePage = () => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [bulkParentId, setBulkParentId] = useState<string | undefined>(undefined);
  const [isUpdating, setIsUpdating] = useState(false);
  const { timeFormat } = useSettingsStore();

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const result = await callResource("tech.mycelia.mongo", {
          action: "find",
          collection: "events",
          query: {},
          options: { sort: { start: -1 } }
        });
        setEvents(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch events');
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  const toggleEventSelection = (eventId: string) => {
    setSelectedEventIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedEventIds(new Set(events.map(e => e._id.toString())));
  };

  const clearSelection = () => {
    setSelectedEventIds(new Set());
    setBulkParentId(undefined);
  };

  const handleBulkSetParent = async () => {
    if (selectedEventIds.size === 0) return;

    setIsUpdating(true);
    try {
      await Promise.all(
        Array.from(selectedEventIds).map(eventId =>
          callResource("tech.mycelia.mongo", {
            action: "updateOne",
            collection: "events",
            query: { _id: { $oid: eventId } },
            update: {
              $set: {
                parentId: bulkParentId,
                updatedAt: new Date(),
              },
            },
          })
        )
      );

      setEvents(prevEvents =>
        prevEvents.map(event =>
          selectedEventIds.has(event._id.toString())
            ? { ...event, parentId: bulkParentId }
            : event
        )
      );

      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update events');
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading events...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
        </div>
      </div>
    );
  }

  const availableParentEvents = events.filter(
    e => !selectedEventIds.has(e._id.toString())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Timeline</h1>
        <Link to="/events/new">
          <Button>
            <PlusIcon className="w-4 h-4 mr-2" />
            Create Event
          </Button>
        </Link>
      </div>

      <div className="border rounded-lg p-2">
        <TimelineChart />
      </div>

      {selectedEventIds.size > 0 && (
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <span className="text-sm font-medium">
                {selectedEventIds.size} event{selectedEventIds.size !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2 flex-1">
                <span className="text-sm text-muted-foreground">Set parent:</span>
                <div className="w-64">
                  <Combobox
                    options={availableParentEvents.map(e => ({
                      value: e._id.toString(),
                      label: e.title,
                    }))}
                    value={bulkParentId}
                    onValueChange={setBulkParentId}
                    placeholder="Select parent event..."
                    searchPlaceholder="Search events..."
                    emptyText="No events found."
                  />
                </div>
                <Button
                  onClick={handleBulkSetParent}
                  disabled={isUpdating}
                  size="sm"
                >
                  {isUpdating ? 'Updating...' : 'Apply'}
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
            >
              <X className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-lg">
        {events.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">No events found</p>
          </div>
        ) : (
          <>
            <div className="p-4 border-b bg-muted/20">
              <div className="flex items-center gap-4">
                <Checkbox
                  checked={selectedEventIds.size === events.length && events.length > 0}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      selectAll();
                    } else {
                      clearSelection();
                    }
                  }}
                />
                <span className="text-sm font-medium">
                  {selectedEventIds.size === events.length && events.length > 0
                    ? 'Deselect all'
                    : 'Select all'}
                </span>
              </div>
            </div>
            <div className="divide-y">
              {events.map((event) => {
                const isSelected = selectedEventIds.has(event._id.toString());
                const parentEvent = event.parentId
                  ? events.find(e => e._id.toString() === event.parentId)
                  : null;

                return (
                  <div
                    key={event._id.toString()}
                    className={`flex items-start gap-4 p-4 transition-colors ${
                      isSelected ? 'bg-muted/50' : 'hover:bg-muted/30'
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleEventSelection(event._id.toString())}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div
                      className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                      style={{ backgroundColor: event.color }}
                    />
                    <Link
                      to={`/events/${event._id.toString()}`}
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-baseline gap-2">
                        <h3 className="font-medium hover:text-primary transition-colors">
                          {event.title}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {event.category}
                        </span>
                      </div>
                      {parentEvent && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Parent: {parentEvent.title}
                        </div>
                      )}
                      {event.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {event.description}
                        </p>
                      )}
                      <div className="text-xs text-muted-foreground mt-2">
                        {formatTime(event.start, timeFormat)}
                        {event.kind === 'range' && event.end && (
                          <> → {formatTime(event.end, timeFormat)}</>
                        )}
                      </div>
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
