import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { callResource } from "@/lib/api";
import type { EventItem } from "@/types/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Trash2, X } from "lucide-react";
import { ColorInput } from "@/components/forms/ColorInput";
import { CategoryInput } from "@/components/forms/CategoryInput";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { EmojiPickerButton } from "@/components/ui/emoji-picker";
import { Combobox } from "@/components/ui/combobox";

const EVENT_CATEGORIES = [
  "geography",
  "life",
  "education",
  "relationship",
  "work",
  "misc",
];

const EventDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [eventResult, allEventsResult] = await Promise.all([
          callResource("tech.mycelia.mongo", {
            action: "findOne",
            collection: "events",
            query: { _id: { $oid: id } },
          }),
          callResource("tech.mycelia.mongo", {
            action: "find",
            collection: "events",
            query: {},
            options: { sort: { start: 1 } },
          }),
        ]);

        if (eventResult) {
          setEvent(eventResult);
          setAllEvents(allEventsResult || []);
        } else {
          setError("Event not found");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch event");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchData();
    }
  }, [id]);

  const autoSave = async (updates: Partial<EventItem>) => {
    if (!event) return;

    setSaving(true);
    try {
      const updateDoc: any = {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      };

      await callResource("tech.mycelia.mongo", {
        action: "updateOne",
        collection: "events",
        query: { _id: event._id },
        update: updateDoc,
      });

      setEvent({ ...event, ...updates });
    } catch (err) {
      console.error("Auto-save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    const confirmed = globalThis.confirm
      ? globalThis.confirm("Delete this event?")
      : true;
    if (!confirmed) return;

    try {
      await callResource("tech.mycelia.mongo", {
        action: "deleteOne",
        collection: "events",
        query: { _id: event._id },
      });
      navigate("/timeline");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete event");
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/timeline">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading event...</p>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/timeline">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error || "Event not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/timeline">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Timeline
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-xs text-muted-foreground">Saving...</span>
          )}
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <Label className="text-sm font-medium">Icon</Label>
              <div className="mt-1">
                <EmojiPickerButton
                  value={event.icon}
                  onChange={(icon) => autoSave({ icon })}
                />
              </div>
            </div>

            <div className="flex-1">
              <Label htmlFor="title" className="text-sm font-medium">
                Title
              </Label>
              <Input
                id="title"
                value={event.title}
                onChange={(e) => autoSave({ title: e.target.value })}
                placeholder="Event title"
                className="mt-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortTitle">Short Title</Label>
            <Input
              id="shortTitle"
              value={event.shortTitle || ""}
              onChange={(e) =>
                autoSave({ shortTitle: e.target.value || undefined })}
              placeholder="Optional compact label"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={event.description || ""}
              onChange={(e) =>
                autoSave({ description: e.target.value || undefined })}
              placeholder="Optional details"
            />
          </div>

          <div className="space-y-2">
            <Label>Kind</Label>
            <ToggleGroup
              value={event.kind}
              options={[
                { value: "point", label: "Point" },
                { value: "range", label: "Range" },
              ]}
              onChange={(value) => {
                const updates: any = { kind: value };
                if (value === "point") {
                  updates.end = undefined;
                }
                autoSave(updates);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <CategoryInput
              id="category"
              value={event.category}
              onChange={(e) => autoSave({ category: e.target.value })}
              categories={EVENT_CATEGORIES}
              placeholder="Event category"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Color</Label>
            <ColorInput
              id="color"
              value={event.color}
              onChange={(e) => autoSave({ color: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="parentId">Parent Event</Label>
            <Combobox
              options={allEvents
                .filter((e) => e._id.toString() !== event._id.toString())
                .map((e) => ({
                  value: e._id.toString(),
                  label: e.title,
                }))}
              value={event.parentId}
              onValueChange={(value) => autoSave({ parentId: value })}
              placeholder="No parent (top level)"
              searchPlaceholder="Search events..."
              emptyText="No events found."
            />
            <p className="text-xs text-muted-foreground">
              When zoomed out, this event will be hidden and its parent will be
              shown instead
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="start">Start</Label>
            <DateTimePicker
              value={event.start}
              onChange={(date) => date && autoSave({ start: date })}
            />
          </div>

          {event.kind === "range" && (
            <div className="space-y-2">
              <Label htmlFor="end">End</Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <DateTimePicker
                    value={event.end || undefined}
                    onChange={(date) => autoSave({ end: date || undefined })}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => autoSave({ end: undefined })}
                  title="Clear end date"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventDetailPage;
